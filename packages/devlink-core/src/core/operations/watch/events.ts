import { EventEmitter } from "node:events";
import { logger } from '../utils/logger';

export interface DevLinkEvent {
  kind: string;
  schemaVersion: string; // "1.0"
  timestamp: string;
  package?: string;
  ticketId?: string;
  // Убрали [key: string]: any для строгой типизации
  // Причина: избежать any типов в публичном API
  // Когда исправить: при полной переработке системы событий
}

// Типы событий
export interface PreflightEvent extends DevLinkEvent {
  kind: 'devlink.preflight';
  packages: Array<{
    package: string;
    buildCommand: string | null;
    devCommand: string | null;
    source: 'OVERRIDE' | 'SCRIPTS' | 'NO_BUILD_SCRIPT';
    status: 'OK' | 'SKIP';
  }>;
}

export interface BuildStartEvent extends DevLinkEvent {
  kind: 'devlink.build.start';
  package: string;
  command: string;
  ticketId: string;
  changedFiles?: string[];
}

export interface BuildResultEvent extends DevLinkEvent {
  kind: 'devlink.build.result';
  package: string;
  ticketId: string;
  success: boolean;
  durationMs: number;
  exitCode: number | string;
  stderrHead?: string[]; // первые ~40 строк
}

export interface LoopGuardCooldownEvent extends DevLinkEvent {
  kind: 'devlink.loopguard.cooldown';
  package: string;
  windowMs: number;
  cooldownMs: number;
  buildsInWindow: number;
}

export interface DegradedHashingEvent extends DevLinkEvent {
  kind: 'devlink.degraded.hashing';
  package: string;
  enabled: boolean;
  reason: string;
}

export interface RelinkDoneEvent extends DevLinkEvent {
  kind: 'devlink.relink.done';
  producer: string;
  consumers: string[];
  filesTouched: number; // счетчик
  ticketId: string;
}

export interface SkippedEvent extends DevLinkEvent {
  kind: 'devlink.info.skipped_no_change';
  package: string;
  reason: string;
}

export interface WatchStoppedEvent extends DevLinkEvent {
  kind: 'devlink.watch.stopped';
}

export interface WatchReadyEvent extends DevLinkEvent {
  kind: 'devlink.watch.ready';
  mode: string;
  providers: number;
  consumers: number;
}

export interface DryRunEvent extends DevLinkEvent {
  kind: 'devlink.dryrun';
  mode: string;
  providers: Array<{
    name: string;
    dir: string;
    buildCommand: string | null;
    devCommand: string | null;
    watchPaths: string[];
  }>;
  consumers: Array<{
    name: string;
    dir: string;
    hasRefreshScript: boolean;
  }>;
  dependencies: Array<{
    provider: string;
    consumers: string[];
  }>;
}

export interface GlobalCooldownEvent extends DevLinkEvent {
  kind: 'devlink.loopguard.global';
  activeCooldowns: number;
  cooldownMs: number;
}

export interface ManualOverrideEvent extends DevLinkEvent {
  kind: 'devlink.loopguard.manual_override';
  package: string;
  reason: string;
}

export interface ConfigErrorEvent extends DevLinkEvent {
  kind: 'devlink.config.error';
  message: string;
  path: string;
}

// Union type для всех событий
export type AllDevLinkEvents = 
  | PreflightEvent
  | BuildStartEvent
  | BuildResultEvent
  | LoopGuardCooldownEvent
  | DegradedHashingEvent
  | RelinkDoneEvent
  | SkippedEvent
  | WatchStoppedEvent
  | WatchReadyEvent
  | DryRunEvent
  | GlobalCooldownEvent
  | ManualOverrideEvent
  | ConfigErrorEvent;

/**
 * Система событий с форматированием
 */
export class DevLinkEventEmitter extends EventEmitter {
  private jsonMode = false;
  private jsonlMode = false;
  
  constructor(jsonMode: boolean = false, jsonlMode: boolean = false) {
    super();
    this.jsonMode = jsonMode;
    this.jsonlMode = jsonlMode;
  }
  
  /**
   * Emit событие с автоматическим форматированием
   * 
   * @param event - типизированное событие из union type AllDevLinkEvents
   * @returns true если событие было обработано
   * 
   * Причина создания отдельного метода: избежать конфликта типов с EventEmitter.emit
   * EventEmitter.emit имеет сигнатуру (eventName: string, ...args: any[]), что не подходит
   * для типизированных событий. Этот метод обеспечивает строгую типизацию.
   * 
   * Когда исправить: при создании собственного EventEmitter без наследования от Node.js EventEmitter
   */
  emitEvent(event: AllDevLinkEvents): boolean {
    // Добавляем обязательные поля
    const enrichedEvent = {
      ...event,
      schemaVersion: '1.0',
      timestamp: new Date().toISOString()
    } as AllDevLinkEvents;
    
    // Логируем для отладки
    logger.debug("Emitting event", { kind: event.kind, package: event.package });
    
    // Форматируем в зависимости от режима
    if (this.jsonMode || this.jsonlMode) {
      this.formatJsonEvent(enrichedEvent);
    } else {
                // Type assertion для совместимости с formatHumanEvent
    // Причина: enrichedEvent имеет тип DevLinkEvent, но formatHumanEvent ожидает AllDevLinkEvents
    // Когда исправить: при унификации типов событий
    this.formatHumanEvent(enrichedEvent as any);
    }
    
    // Используем type assertion для совместимости с EventEmitter
    // Причина: EventEmitter.emit ожидает (eventName: string, ...args: any[])
    // а мы передаем типизированное событие как второй аргумент
    // Когда исправить: при создании собственного EventEmitter без наследования
    return super.emit('event', enrichedEvent as any);
  }
  
  /**
   * JSON форматирование
   * 
   * @param event - событие для форматирования
   * 
   * Причина type assertion: formatJsonEvent принимает DevLinkEvent (базовый тип),
   * но sanitizeEvent ожидает AllDevLinkEvents (конкретные типы). В runtime это
   * работает корректно, но TypeScript требует явного приведения типов.
   * 
   * Когда исправить: при унификации типов событий
   */
  private formatJsonEvent(event: DevLinkEvent): void {
    const sanitized = this.sanitizeEvent(event as any);
    const output = JSON.stringify(sanitized);
    
    if (this.jsonlMode) {
      console.log(output);
    } else {
      console.log(output);
    }
  }
  
  /**
   * Human-readable форматирование
   */
  private formatHumanEvent(event: DevLinkEvent): void {
    const timestamp = new Date(event.timestamp).toLocaleTimeString();
    const pkg = event.package ? `@${event.package}` : '';
    
    switch (event.kind) {
      case 'devlink.preflight':
        this.formatPreflightEvent(event as PreflightEvent);
        break;
        
      case 'devlink.build.start':
        this.formatBuildStartEvent(event as BuildStartEvent, timestamp, pkg);
        break;
        
      case 'devlink.build.result':
        this.formatBuildResultEvent(event as BuildResultEvent, timestamp, pkg);
        break;
        
      case 'devlink.loopguard.cooldown':
        this.formatLoopGuardEvent(event as LoopGuardCooldownEvent, timestamp, pkg);
        break;
        
      case 'devlink.degraded.hashing':
        this.formatDegradedHashingEvent(event as DegradedHashingEvent, timestamp, pkg);
        break;
        
      case 'devlink.relink.done':
        this.formatRelinkDoneEvent(event as RelinkDoneEvent, timestamp);
        break;
        
      case 'devlink.info.skipped_no_change':
        this.formatSkippedEvent(event as SkippedEvent, timestamp, pkg);
        break;
        
      case 'devlink.watch.stopped':
        console.log(`\n🔭 devlink:watch stopped\n`);
        break;
        
      default:
        console.log(`[${timestamp}] ${event.kind}${pkg ? ` ${pkg}` : ''}`);
    }
  }
  
  private formatPreflightEvent(event: PreflightEvent): void {
    console.log('🔍 Preflight Validation\n');
    
    // Таблица
    const header = 'Package'.padEnd(25) + 'Build Command'.padEnd(20) + 'Dev Command'.padEnd(20) + 'Source'.padEnd(15) + 'Status';
    console.log(header);
    console.log('─'.repeat(80));
    
    for (const pkg of event.packages) {
      const packageName = pkg.package.padEnd(25);
      const buildCmd = (pkg.buildCommand || 'N/A').padEnd(20);
      const devCmd = (pkg.devCommand || 'N/A').padEnd(20);
      const source = pkg.source.padEnd(15);
      const status = pkg.status === 'OK' ? '✓ OK' : '⚠ SKIP';
      
      console.log(`${packageName}${buildCmd}${devCmd}${source}${status}`);
    }
    
    const skipped = event.packages.filter(p => p.status === 'SKIP');
    if (skipped.length > 0) {
      console.log(`\n⚠ Warning: ${skipped.length} package(s) skipped (no build script)`);
      console.log('  Run \'kb devkit sync\' to add standard build scripts\n');
    } else {
      console.log('\n');
    }
  }
  
  private formatBuildStartEvent(event: BuildStartEvent, timestamp: string, pkg: string): void {
    const files = event.changedFiles?.slice(0, 3).join(', ') || '';
    const moreFiles = event.changedFiles && event.changedFiles.length > 3 
      ? ` +${event.changedFiles.length - 3} more` 
      : '';
    
    console.log(`[${timestamp}] ▶ build ${pkg} (changed: ${event.changedFiles?.length || 0} files, +0.4s)`);
    if (files) {
      console.log(`  ↳ ${files}${moreFiles}`);
    }
  }
  
  private formatBuildResultEvent(event: BuildResultEvent, timestamp: string, pkg: string): void {
    const duration = this.formatDuration(event.durationMs);
    
    if (event.success) {
      console.log(`  ↳ ✓ ${pkg} in ${duration}`);
    } else {
      console.log(`  ↳ ✗ ${pkg} failed (exit ${event.exitCode})`);
      
      if (event.stderrHead && event.stderrHead.length > 0) {
        console.log('  Error output:');
        event.stderrHead.slice(0, 10).forEach(line => {
          console.log(`    ${line}`);
        });
        if (event.stderrHead.length > 10) {
          console.log(`    ... and ${event.stderrHead.length - 10} more lines`);
        }
      }
    }
  }
  
  private formatLoopGuardEvent(event: LoopGuardCooldownEvent, timestamp: string, pkg: string): void {
    console.log(`[${timestamp}] ⏸ ${pkg} cooldown ${event.cooldownMs/1000}s (loop guard)`);
  }
  
  private formatDegradedHashingEvent(event: DegradedHashingEvent, timestamp: string, pkg: string): void {
    const status = event.enabled ? 'enabled' : 'disabled';
    console.log(`[${timestamp}] 🔍 ${pkg} degraded hashing ${status} (${event.reason})`);
  }
  
  private formatRelinkDoneEvent(event: RelinkDoneEvent, timestamp: string): void {
    const consumerList = event.consumers.slice(0, 2).join(', ');
    const moreConsumers = event.consumers.length > 2 ? ` +${event.consumers.length - 2} more` : '';
    
    console.log(`[${timestamp}] 🔗 relink ${event.producer} → ${consumerList}${moreConsumers} (${event.filesTouched} files)`);
  }
  
  private formatSkippedEvent(event: SkippedEvent, timestamp: string, pkg: string): void {
    console.log(`[${timestamp}] • ${pkg} unchanged (skip)`);
  }
  
  /**
   * Форматирование длительности
   */
  private formatDuration(ms: number): string {
    if (ms < 1000) {return `${ms}ms`;}
    return `${(ms / 1000).toFixed(1)}s`;
  }
  
  /**
   * Санитизация событий (удаление секретов)
   * 
   * @param event - исходное событие
   * @returns санитизированное событие
   * 
   * Причина использования type assertion: spread операция {...event} создает
   * тип, совместимый с базовым DevLinkEvent, но не с конкретными типами из AllDevLinkEvents.
   * Type assertion позволяет сохранить типизацию при добавлении полей.
   * 
   * Когда исправить: при использовании более строгой типизации с mapped types
   */
  private sanitizeEvent(event: AllDevLinkEvents): AllDevLinkEvents {
    const sanitized = { ...event } as any;
    
    // Санитизируем stderrHead если есть
    if (sanitized.stderrHead && Array.isArray(sanitized.stderrHead)) {
      sanitized.stderrHead = sanitized.stderrHead.map((line: string) => 
        this.sanitizeSecrets(line)
      );
    }
    
    return sanitized;
  }
  
  /**
   * Удаление секретов из текста
   * 
   * @param text - исходный текст
   * @returns текст с замаскированными секретами
   * 
   * Причина: защита от случайного логирования API ключей, токенов и паролей
   * в stdout/stderr выводах. Особенно важно при --json режиме для CI/CD.
   * 
   * Когда исправить: при добавлении более сложных паттернов маскировки
   */
  private sanitizeSecrets(text: string): string {
    return text
      .replace(/\x1b\[[0-9;]*m/g, '') // удаляем ANSI если --json
      .replace(/API_KEY=\S+/gi, 'API_KEY=***')
      .replace(/TOKEN=\S+/gi, 'TOKEN=***')
      .replace(/SECRET=\S+/gi, 'SECRET=***')
      .replace(/PASSWORD=\S+/gi, 'PASSWORD=***');
  }
}
