/**
 * @module @devlink/infra/logging/logger
 * DevLink logger - wrapper around @kb-labs/core-sys/logging
 * 
 * Provides backward-compatible API while using the new unified logging system.
 * All logs are prefixed with 'devlink:' category.
 */

import { getLogger, type Logger } from '@kb-labs/core-sys/logging';

// Создаем логгер с категорией devlink для всех логов
const coreLogger = getLogger('devlink');

/**
 * Backward-compatible logger interface
 * Maintains the same API as the old logger for easy migration
 */
export const logger = {
  level: (process.env.KB_DEVLINK_LOG_LEVEL || process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
  
  debug(msg: string, extra?: unknown) {
    coreLogger.debug(msg, typeof extra === 'object' && extra !== null ? extra as Record<string, unknown> : extra ? { value: extra } : undefined);
  },
  
  info(msg: string, extra?: unknown) {
    coreLogger.info(msg, typeof extra === 'object' && extra !== null ? extra as Record<string, unknown> : extra ? { value: extra } : undefined);
  },
  
  warn(msg: string, extra?: unknown) {
    coreLogger.warn(msg, typeof extra === 'object' && extra !== null ? extra as Record<string, unknown> : extra ? { value: extra } : undefined);
  },
  
  error(msg: string, extra?: unknown) {
    coreLogger.error(msg, typeof extra === 'object' && extra !== null ? extra as Record<string, unknown> : extra ? { value: extra } : undefined);
  },
};

// Экспортируем также новый Logger тип для постепенной миграции
export type { Logger };
export { getLogger };