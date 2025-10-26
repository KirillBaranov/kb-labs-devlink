import { logger } from "../../utils/logger";

export interface SuppressEntry {
  path: string;
  actor: 'devlink:build' | 'devlink:relink';
  ticketId?: string;
  expiresAt: number;
}

/**
 * LRU-кеш с ограничением по памяти для игнорирования собственных записей
 */
export class SelfWriteSuppressor {
  private cache = new Map<string, SuppressEntry>();
  private ttlMs = 8000; // 8 секунд
  private maxMemoryBytes = 4 * 1024 * 1024; // 4 MB
  private maxEntries = 1000;
  
  constructor() {
    // Периодическая очистка каждые 30 секунд
    setInterval(() => this.cleanup(), 30000);
  }
  
  /**
   * Пакетная маркировка (только измененные файлы, не весь dist)
   */
  mark(paths: string[], actor: 'devlink:build' | 'devlink:relink', ticketId?: string): void {
    const now = Date.now();
    const expiresAt = now + this.ttlMs;
    
    for (const path of paths) {
      this.cache.set(path, {
        path,
        actor,
        ticketId,
        expiresAt
      });
    }
    
    // Проверяем лимиты
    this.enforceLimits();
    
    logger.debug("Marked paths as self-write", {
      paths: paths.length,
      actor,
      ticketId,
      cacheSize: this.cache.size
    });
  }
  
  /**
   * Проверка подавления
   */
  isSuppressed(path: string): boolean {
    const entry = this.cache.get(path);
    if (!entry) return false;
    
    const now = Date.now();
    if (entry.expiresAt <= now) {
      this.cache.delete(path);
      return false;
    }
    
    return true;
  }
  
  /**
   * Периодическая очистка + проверка памяти
   */
  cleanup(): void {
    const now = Date.now();
    let cleaned = 0;
    
    // Удаляем истекшие записи
    for (const [path, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(path);
        cleaned++;
      }
    }
    
    // Проверяем лимит памяти
    if (this.estimateMemoryUsage() > this.maxMemoryBytes) {
      this.enforceMemoryLimit();
    }
    
    if (cleaned > 0) {
      logger.debug("Cleaned expired suppress entries", {
        cleaned,
        remaining: this.cache.size
      });
    }
  }
  
  /**
   * Оценка использованной памяти
   */
  private estimateMemoryUsage(): number {
    let total = 0;
    for (const [path, entry] of this.cache) {
      // Примерная оценка: path + entry data
      total += path.length * 2; // UTF-16
      total += 50; // entry overhead
    }
    return total;
  }
  
  /**
   * Принудительное соблюдение лимитов
   */
  private enforceLimits(): void {
    // Лимит по количеству записей
    if (this.cache.size > this.maxEntries) {
      const entries = Array.from(this.cache.entries());
      // Сортируем по времени истечения, удаляем самые старые
      entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
      
      const toRemove = entries.slice(0, this.cache.size - this.maxEntries);
      for (const [path] of toRemove) {
        this.cache.delete(path);
      }
      
      logger.debug("Enforced entry limit", {
        removed: toRemove.length,
        remaining: this.cache.size
      });
    }
  }
  
  /**
   * Принудительное соблюдение лимита памяти
   */
  private enforceMemoryLimit(): void {
    const entries = Array.from(this.cache.entries());
    // Сортируем по времени истечения
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    
    // Удаляем 20% самых старых записей
    const toRemove = Math.floor(entries.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
    
    logger.debug("Enforced memory limit", {
      removed: toRemove,
      remaining: this.cache.size,
      estimatedMemory: this.estimateMemoryUsage()
    });
  }
  
  /**
   * Получить статистику кэша
   */
  getStats(): {
    size: number;
    memoryUsage: number;
    oldestEntry?: number;
    newestEntry?: number;
  } {
    const entries = Array.from(this.cache.values());
    const timestamps = entries.map(e => e.expiresAt - this.ttlMs);
    
    return {
      size: this.cache.size,
      memoryUsage: this.estimateMemoryUsage(),
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined
    };
  }
}
