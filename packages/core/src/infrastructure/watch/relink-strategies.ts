import { promises as fsp } from "node:fs";
import { join, relative } from "node:path";
import { platform } from "node:os";
import { logger } from '../infrastructure/logging/logger';
import { runCommand } from '../infrastructure/process/run-command';
import type { ProviderConfig, ConsumerConfig } from '../core/operations/watch';

export interface RelinkResult {
  ok: boolean;
  touchedFiles: number; // счетчик, не список
  errors: string[];
}

export interface RelinkStrategy {
  relink(producer: ProviderConfig, consumers: ConsumerConfig[]): Promise<RelinkResult>;
}

/**
 * Стратегия symlink для local mode
 */
export class SymlinkStrategy implements RelinkStrategy {
  async relink(producer: ProviderConfig, consumers: ConsumerConfig[]): Promise<RelinkResult> {
    const errors: string[] = [];
    let touchedFiles = 0;
    
    logger.info("Relinking with symlink strategy", {
      producer: producer.name,
      consumers: consumers.length
    });
    
    for (const consumer of consumers) {
      try {
        const result = await this.createSymlink(producer, consumer);
        touchedFiles += result.touchedFiles;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to link ${consumer.name}: ${error}`);
        logger.error("Symlink failed", { 
          producer: producer.name, 
          consumer: consumer.name, 
          error 
        });
      }
    }
    
    return {
      ok: errors.length === 0,
      touchedFiles,
      errors
    };
  }
  
  /**
   * Создание symlink с учетом Windows
   */
  private async createSymlink(producer: ProviderConfig, consumer: ConsumerConfig): Promise<{ touchedFiles: number }> {
    const producerDist = join(producer.dir, 'dist');
    const consumerNodeModules = join(consumer.dir, 'node_modules');
    const linkPath = join(consumerNodeModules, producer.name);
    
    // Проверяем существование dist
    try {
      await fsp.access(producerDist);
    } catch {
      throw new Error(`Producer dist not found: ${producerDist}`);
    }
    
    // Удаляем существующую ссылку
    try {
      await fsp.unlink(linkPath);
    } catch {
      // Игнорируем ошибку если файл не существует
    }
    
    // Создаем новую ссылку
    if (platform() === 'win32') {
      // Windows: используем junction вместо symlink
      await this.createJunction(producerDist, linkPath);
    } else {
      // Unix: обычный symlink
      await fsp.symlink(producerDist, linkPath, 'dir');
    }
    
    logger.debug("Symlink created", {
      producer: producer.name,
      consumer: consumer.name,
      target: producerDist,
      link: linkPath
    });
    
    return { touchedFiles: 1 };
  }
  
  /**
   * Создание junction на Windows
   */
  private async createJunction(target: string, linkPath: string): Promise<void> {
    // На Windows используем mklink через cmd
    const command = `mklink /J "${linkPath}" "${target}"`;
    
    try {
      await runCommand(command, {
        cwd: process.cwd(),
        stdio: 'pipe',
        allowFail: false
      });
    } catch (err) {
      // Fallback: попробуем обычный symlink
      await fsp.symlink(target, linkPath, 'dir');
    }
  }
}

/**
 * Стратегия yalc для yalc mode
 */
export class YalcStrategy implements RelinkStrategy {
  private yalcThrottle = new Map<string, number>();
  private throttleMs = 500; // 2/sec
  
  async relink(producer: ProviderConfig, consumers: ConsumerConfig[]): Promise<RelinkResult> {
    const errors: string[] = [];
    let touchedFiles = 0;
    
    logger.info("Relinking with yalc strategy", {
      producer: producer.name,
      consumers: consumers.length
    });
    
    try {
      // Throttle yalc publish
      await this.throttleYalcPublish(producer.name);
      
      // yalc publish в producer
      await runCommand('yalc publish', {
        cwd: producer.dir,
        stdio: 'pipe',
        allowFail: false
      });
      
      touchedFiles += 1; // yalc publish создает файлы
      
      // yalc update в каждом consumer
      const updatePromises = consumers.map(async (consumer) => {
        try {
          await runCommand(`yalc update ${producer.name}`, {
            cwd: consumer.dir,
            stdio: 'pipe',
            allowFail: false
          });
          return 1; // touchedFiles
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          errors.push(`Failed to update ${consumer.name}: ${error}`);
          return 0;
        }
      });
      
      const results = await Promise.all(updatePromises);
      touchedFiles += results.reduce<number>((sum, count) => sum + count, 0);
      
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      errors.push(`yalc publish failed: ${error}`);
    }
    
    return {
      ok: errors.length === 0,
      touchedFiles,
      errors
    };
  }
  
  /**
   * Throttle yalc publish
   */
  private async throttleYalcPublish(producerName: string): Promise<void> {
    const lastPublish = this.yalcThrottle.get(producerName) || 0;
    const timeSince = Date.now() - lastPublish;
    
    if (timeSince < this.throttleMs) {
      const waitTime = this.throttleMs - timeSince;
      logger.debug("Throttling yalc publish", { 
        producer: producerName, 
        waitMs: waitTime 
      });
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    this.yalcThrottle.set(producerName, Date.now());
  }
}

/**
 * Стратегия refresh script для local mode
 */
export class RefreshScriptStrategy implements RelinkStrategy {
  async relink(producer: ProviderConfig, consumers: ConsumerConfig[]): Promise<RelinkResult> {
    const errors: string[] = [];
    let touchedFiles = 0;
    
    logger.info("Relinking with refresh script strategy", {
      producer: producer.name,
      consumers: consumers.length
    });
    
    for (const consumer of consumers) {
      if (!consumer.hasRefreshScript) {
        logger.debug("Consumer has no refresh script", { 
          consumer: consumer.name 
        });
        continue;
      }
      
      try {
        await runCommand('pnpm run devlink:refresh', {
          cwd: consumer.dir,
          stdio: 'pipe',
          allowFail: false
        });
        
        touchedFiles += 1;
        logger.debug("Refresh script executed", { 
          consumer: consumer.name 
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        errors.push(`Failed to refresh ${consumer.name}: ${error}`);
        logger.error("Refresh script failed", { 
          consumer: consumer.name, 
          error 
        });
      }
    }
    
    return {
      ok: errors.length === 0,
      touchedFiles,
      errors
    };
  }
}

/**
 * Менеджер relink с выбором стратегии
 */
export class RelinkManager {
  private strategy: RelinkStrategy;
  private suppressor: any; // SelfWriteSuppressor
  
  constructor(strategy: RelinkStrategy, suppressor: any) {
    this.strategy = strategy;
    this.suppressor = suppressor;
  }
  
  /**
   * Выполнение relink с маркировкой в suppressor
   */
  async relink(producer: ProviderConfig, consumers: ConsumerConfig[], ticketId: string): Promise<RelinkResult> {
    // Топологическая сортировка консюмеров
    const sorted = this.topologicalSort(consumers);
    
    // Выполняем relink
    const result = await this.strategy.relink(producer, sorted);
    
    // Маркировка измененных файлов в suppressor
    if (result.ok) {
      const changedFiles = await this.collectChangedFiles(sorted);
      this.suppressor.mark(changedFiles, 'devlink:relink', ticketId);
    }
    
    return result;
  }
  
  /**
   * Топологическая сортировка консюмеров
   */
  private topologicalSort(consumers: ConsumerConfig[]): ConsumerConfig[] {
    // Простая сортировка по имени для стабильности
    // В реальной реализации можно добавить анализ зависимостей
    return [...consumers].sort((a, b) => a.name.localeCompare(b.name));
  }
  
  /**
   * Сбор измененных файлов после relink
   */
  private async collectChangedFiles(consumers: ConsumerConfig[]): Promise<string[]> {
    const changedFiles: string[] = [];
    
    for (const consumer of consumers) {
      try {
        // Ищем файлы в node_modules, которые могли измениться
        const nodeModulesPath = join(consumer.dir, 'node_modules');
        const entries = await fsp.readdir(nodeModulesPath, { withFileTypes: true });
        
        for (const entry of entries) {
          if (entry.isSymbolicLink()) {
            const linkPath = join(nodeModulesPath, entry.name);
            changedFiles.push(relative(consumer.dir, linkPath));
          }
        }
      } catch (err) {
        logger.debug("Failed to collect changed files", { 
          consumer: consumer.name, 
          error: err 
        });
      }
    }
    
    return changedFiles;
  }
}
