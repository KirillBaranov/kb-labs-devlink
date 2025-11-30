import { spawn, type ChildProcess } from "node:child_process";
import PQueue from "p-queue";
import { EventEmitter } from "node:events";
import { logger } from '@devlink/shared/utils/logger';
import { runCommand } from '@devlink/shared/utils/runCommand';
import type { InputSignature } from "./signature";

export interface BuildTask {
  package: string;
  packageDir: string; // путь к директории пакета
  ticketId: string;
  priority: number; // количество прямых консюмеров
  changedFiles: string[];
  signature: InputSignature;
  type: 'one-shot' | 'long-running';
  command: string; // команда для выполнения
  process?: ChildProcess;
  timeoutMs: number;
  enqueuedAt: number; // для FIFO tie-break
}

export interface BuildResult {
  success: boolean;
  durationMs: number;
  exitCode: number | string;
  stderrHead?: string[]; // первые ~40 строк
  error?: BuildError;
}

export interface BuildError {
  code: 'ERR_NO_BUILD_SCRIPT' | 'ERR_BUILD_FAILED' | 'ERR_BUILD_TIMEOUT' | 'ERR_LOOP_GUARD_COOLDOWN';
  message: string;
  hint: string;
}

const ERROR_HINTS: Record<string, string> = {
  ERR_NO_BUILD_SCRIPT: 'Run kb devkit sync to add build scripts',
  ERR_BUILD_TIMEOUT: 'Increase timeout via kbLabs.watch.timeoutMs in package.json',
  ERR_BUILD_FAILED: 'Check stderr output above for details',
  ERR_LOOP_GUARD_COOLDOWN: 'Wait for cooldown or use --force-build'
};

/**
 * Управление сборками с приоритетами, cancel in-flight и таймаутами
 */
export class BuildOrchestrator extends EventEmitter {
  private queue: PQueue;
  private inFlight = new Map<string, BuildTask>();
  private lastSuccess = new Map<string, InputSignature>();
  private agingInterval = 5000; // 5 секунд
  private maxQueueSize = 100;
  private retryWindow = 30000; // 30 секунд
  private retryAttempts = new Map<string, { count: number; lastAttempt: number }>();
  
  constructor(concurrency: number = 5) {
    super();
    
    this.queue = new PQueue({
      concurrency
    });
  }
  
  /**
   * Постановка в очередь с проверкой signature и cancel in-flight
   */
  async enqueueBuild(task: BuildTask): Promise<void> {
    // Проверяем, не изменилась ли сигнатура
    const lastSuccess = this.lastSuccess.get(task.package);
    if (lastSuccess && !this.hasSignatureChanged(lastSuccess, task.signature)) {
      // События эмитятся в главном DevLinkWatcher
      return;
    }
    
    // Cancel in-flight билд
    await this.cancelBuild(task.package);
    
    // Проверяем лимит очереди
    if (this.queue.size >= this.maxQueueSize) {
      this.dropOldDuplicate(task.package);
    }
    
    // Добавляем в очередь
    await this.queue.add(() => this.executeBuild(task));
  }
  
  /**
   * Отмена in-flight билда (SIGTERM → 800ms → SIGKILL)
   */
  async cancelBuild(pkg: string): Promise<void> {
    const task = this.inFlight.get(pkg);
    if (!task || !task.process) {return;}
    
    logger.debug("Cancelling in-flight build", { package: pkg });
    
    try {
      // SIGTERM
      task.process.kill('SIGTERM');
      
      // Ждем 800ms
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Если процесс еще жив, SIGKILL
      if (!task.process.killed) {
        task.process.kill('SIGKILL');
      }
    } catch (err) {
      logger.debug("Error cancelling build", { package: pkg, error: err });
    }
    
    this.inFlight.delete(pkg);
  }
  
  /**
   * Выполнение билда с таймаутом
   */
  private async executeBuild(task: BuildTask): Promise<BuildResult> {
    const startTime = Date.now();
    this.inFlight.set(task.package, task);
    
    // События эмитятся в главном DevLinkWatcher
    
    try {
      let result: BuildResult;
      
      if (task.type === 'one-shot') {
        result = await this.executeOneShotBuild(task);
      } else {
        result = await this.executeLongRunningBuild(task);
      }
      
      const durationMs = Date.now() - startTime;
      result.durationMs = durationMs;
      
      // Обновляем lastSuccess при успехе
      if (result.success) {
        this.lastSuccess.set(task.package, task.signature);
        this.clearRetryAttempts(task.package);
      } else {
        // Проверяем retry
        if (this.shouldRetry(task, result)) {
          this.scheduleRetry(task);
        }
      }
      
      // События эмитятся в главном DevLinkWatcher
      
      return result;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);
      
      const result: BuildResult = {
        success: false,
        durationMs,
        exitCode: 'ERROR',
        error: {
          code: 'ERR_BUILD_FAILED',
          message: error,
          hint: ERROR_HINTS.ERR_BUILD_FAILED || 'Unknown error'
        }
      };
      
      // События эмитятся в главном DevLinkWatcher
      
      return result;
    } finally {
      this.inFlight.delete(task.package);
    }
  }
  
  /**
   * Выполнение одноразового билда
   */
  private async executeOneShotBuild(task: BuildTask): Promise<BuildResult> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (task.process) {
          task.process.kill('SIGTERM');
        }
        resolve({
          success: false,
          durationMs: 0,
          exitCode: 'ETIMEDOUT',
          error: {
            code: 'ERR_BUILD_TIMEOUT',
            message: `Build timed out after ${task.timeoutMs}ms`,
            hint: ERROR_HINTS.ERR_BUILD_TIMEOUT || 'Unknown timeout error'
          }
        });
      }, task.timeoutMs);
      
      // Запускаем процесс
      const [cmd, ...args] = this.parseCommand(task.command);
      const process = spawn(cmd, args, {
        cwd: task.packageDir, // Используем путь к директории пакета
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      task.process = process;
      
      let stderr = '';
      
      process.stderr?.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('close', (code) => {
        clearTimeout(timeout);
        
        const stderrHead = this.formatStderrHead(stderr);
        
        resolve({
          success: code === 0,
          durationMs: 0,
          exitCode: code || 0,
          stderrHead
        });
      });
    });
  }
  
  /**
   * Выполнение долгоживущего билда (dev-процесс)
   */
  private async executeLongRunningBuild(task: BuildTask): Promise<BuildResult> {
    // Для dev-процессов мы не запускаем билд, а ждем завершения
    // от ProcessManager
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          durationMs: 0,
          exitCode: 'ETIMEDOUT',
          error: {
            code: 'ERR_BUILD_TIMEOUT',
            message: `Dev process timed out after ${task.timeoutMs}ms`,
            hint: ERROR_HINTS.ERR_BUILD_TIMEOUT || 'Unknown timeout error'
          }
        });
      }, task.timeoutMs);
      
      // В реальной реализации здесь будет ожидание события
      // от ProcessManager о завершении билда
      // Пока что возвращаем успех
      setTimeout(() => {
        clearTimeout(timeout);
        resolve({
          success: true,
          durationMs: 0,
          exitCode: 0
        });
      }, 1000);
    });
  }
  
  /**
   * Retry логика (1 попытка в 30 сек если сигнатура изменилась)
   */
  private shouldRetry(task: BuildTask, result: BuildResult): boolean {
    if (result.success) {return false;}
    
    const retryInfo = this.retryAttempts.get(task.package);
    const now = Date.now();
    
    // Проверяем окно retry
    if (retryInfo) {
      if (now - retryInfo.lastAttempt < this.retryWindow) {
        return retryInfo.count < 1; // максимум 1 retry
      }
    }
    
    return true;
  }
  
  /**
   * Парсинг команды для spawn
   * 
   * @param command - команда из package.json (например, "pnpm run build" или "tsc")
   * @returns [command, ...args] для spawn
   * 
   * Причина: spawn требует отдельные аргументы, а не строку команды.
   * Этот метод разбирает строку команды на команду и аргументы.
   * 
   * Когда исправить: при добавлении поддержки сложных команд с кавычками и экранированием
   */
  private parseCommand(command: string): [string, ...string[]] {
    // Простой парсинг - разбиваем по пробелам
    // TODO: добавить поддержку кавычек и экранирования
    const parts = command.trim().split(/\s+/);
    
    if (parts.length === 0) {
      throw new Error(`Empty command: "${command}"`);
    }
    
    const [cmd, ...args] = parts;
    
    // Проверяем, что команда не пустая
    if (!cmd) {
      throw new Error(`Invalid command: "${command}"`);
    }
    
    return [cmd, ...args];
  }
  
  /**
   * Планирование retry
   */
  private scheduleRetry(task: BuildTask): void {
    const retryInfo = this.retryAttempts.get(task.package) || { count: 0, lastAttempt: 0 };
    retryInfo.count++;
    retryInfo.lastAttempt = Date.now();
    this.retryAttempts.set(task.package, retryInfo);
    
    // Планируем retry через 5 секунд
    setTimeout(() => {
      this.enqueueBuild(task);
    }, 5000);
  }
  
  /**
   * Очистка retry попыток
   */
  private clearRetryAttempts(pkg: string): void {
    this.retryAttempts.delete(pkg);
  }
  
  /**
   * Drop old duplicates при переполнении
   */
  private dropOldDuplicate(pkg: string): void {
    // Удаляем старые задачи для того же пакета
    // В реальной реализации нужно будет модифицировать PQueue
    logger.debug("Dropping old duplicate", { package: pkg });
  }
  
  /**
   * Проверка изменения сигнатуры
   */
  private hasSignatureChanged(prev: InputSignature, next: InputSignature): boolean {
    return prev.hash !== next.hash;
  }
  
  /**
   * Форматирование stderr (первые ~40 строк)
   */
  private formatStderrHead(stderr: string): string[] {
    const lines = stderr.split('\n').slice(0, 40);
    return lines.filter(line => line.trim().length > 0);
  }
  
  /**
   * Ожидание завершения всех задач
   */
  async drain(): Promise<void> {
    await this.queue.onIdle();
  }
  
  /**
   * Получить статистику
   */
  getStats(): {
    queueSize: number;
    inFlight: string[];
    lastSuccess: string[];
  } {
    return {
      queueSize: this.queue.size,
      inFlight: Array.from(this.inFlight.keys()),
      lastSuccess: Array.from(this.lastSuccess.keys())
    };
  }
}
