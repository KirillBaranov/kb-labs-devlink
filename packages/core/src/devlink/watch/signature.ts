import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { logger } from "../../utils/logger";

export interface InputSignature {
  type: 'fast' | 'slow';
  hash: string;
  files: Map<string, FileSignature>; // path -> signature
  timestamp: number;
}

export interface FileSignature {
  path: string;
  size: number;
  mtime: number;
  hash?: string; // только для slow mode
}

export interface FileDelta {
  path: string;
  type: 'add' | 'change' | 'delete';
  size?: number;
  mtime?: number;
}

/**
 * Инкрементальная система сигнатур для отслеживания изменений файлов
 * без повторного обхода файловой системы
 */
export class SignatureComputer {
  private metaCache = new Map<string, FileSignature>();
  private workerPool?: any; // Piscina worker pool для slow hashing
  
  constructor(private pkgDir: string) {
    // Инициализация worker pool для slow hashing (если нужно)
    // this.workerPool = new Piscina({ maxThreads: 2 });
  }
  
  /**
   * Применить дельту изменений из chokidar
   */
  applyDelta(changes: FileDelta[]): void {
    for (const change of changes) {
      const fullPath = join(this.pkgDir, change.path);
      
      switch (change.type) {
        case 'add':
        case 'change':
          if (change.size !== undefined && change.mtime !== undefined) {
            this.metaCache.set(change.path, {
              path: change.path,
              size: change.size,
              mtime: change.mtime
            });
          }
          break;
          
        case 'delete':
          this.metaCache.delete(change.path);
          break;
      }
    }
    
    logger.debug("Applied delta to signature cache", {
      changes: changes.length,
      cacheSize: this.metaCache.size
    });
  }
  
  /**
   * Fast: rolling hash по кэшу метаданных (size|mtime), без stat
   */
  computeFast(): InputSignature {
    const files = new Map(this.metaCache);
    const hash = this.computeRollingHash(files);
    
    return {
      type: 'fast',
      hash,
      files,
      timestamp: Date.now()
    };
  }
  
  /**
   * Slow: контент-хеш (sha256) только для изменившихся путей
   */
  async computeSlow(onlyPaths?: string[]): Promise<InputSignature> {
    const files = new Map<string, FileSignature>();
    const pathsToHash = onlyPaths || Array.from(this.metaCache.keys());
    
    // Хешируем только указанные пути
    for (const path of pathsToHash) {
      const cached = this.metaCache.get(path);
      if (!cached) continue;
      
      try {
        const fullPath = join(this.pkgDir, path);
        const content = await fsp.readFile(fullPath, 'utf-8');
        const hash = createHash('sha256').update(content).digest('hex');
        
        files.set(path, {
          ...cached,
          hash
        });
      } catch (err) {
        logger.debug("Failed to hash file", { path, error: err });
        // Используем кэшированную версию без hash
        files.set(path, cached);
      }
    }
    
    const hash = this.computeRollingHash(files);
    
    return {
      type: 'slow',
      hash,
      files,
      timestamp: Date.now()
    };
  }
  
  /**
   * Сравнение сигнатур
   */
  hasChanged(prev: InputSignature, next: InputSignature): boolean {
    return prev.hash !== next.hash;
  }
  
  /**
   * Очистка кэша для пакета
   */
  clear(): void {
    this.metaCache.clear();
    logger.debug("Cleared signature cache");
  }
  
  /**
   * Коммутативный rolling hash для независимости от порядка
   */
  private computeRollingHash(files: Map<string, FileSignature>): string {
    let hash = 0n;
    
    for (const [path, sig] of files) {
      // XOR-based hash для независимости от порядка
      const pathHash = this.siphash(path);
      const metaHash = this.siphash(`${sig.size}|${sig.mtime}`);
      const contentHash = sig.hash ? this.siphash(sig.hash) : 0n;
      
      hash ^= (pathHash ^ metaHash ^ contentHash);
    }
    
    return hash.toString(16);
  }
  
  /**
   * Простая реализация siphash для хеширования строк
   */
  private siphash(str: string): bigint {
    const hash = createHash('sha256').update(str).digest();
    return BigInt('0x' + hash.slice(0, 8).toString('hex'));
  }
}
