import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { logger } from "../../utils/logger";

export interface DevProcess {
  package: string;
  command: string;
  process: ChildProcess;
  state: 'starting' | 'idle' | 'building';
  lastBuildStart?: number;
  lastBuildEnd?: number;
  stdoutParser: OutputParser;
  quietWindowTimer?: NodeJS.Timeout;
  overlapped?: boolean;
}

export interface OutputParser {
  // Primary: парсинг stdout
  startPatterns: RegExp[]; // /Build started|Rebuilding|Starting/i
  endPatterns: RegExp[]; // /Build finished|Watching for changes/i
  
  // Извлечение duration из вывода
  extractDuration(line: string): number | null;
}

/**
 * Управление долгоживущими dev-процессами с двумя детекторами финиша
 */
export class ProcessManager extends EventEmitter {
  private processes = new Map<string, DevProcess>();
  private lastEndSignal = new Map<string, number>();
  private quietWindowMs = 250; // 200-300ms без событий = build finished
  
  constructor() {
    super();
  }
  
  /**
   * Запуск dev-процесса (только если нет one-shot билда для пакета)
   */
  async startDevProcess(pkg: string, command: string): Promise<void> {
    if (this.processes.has(pkg)) {
      logger.debug("Dev process already running", { package: pkg });
      return;
    }
    
    logger.info("Starting dev process", { package: pkg, command });
    
    // Парсим команду для правильного spawn
    const [cmd, ...args] = this.parseCommand(command);
    
    const process = spawn(cmd, args, {
      cwd: pkg,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    const devProcess: DevProcess = {
      package: pkg,
      command,
      process,
      state: 'starting',
      stdoutParser: this.createOutputParser()
    };
    
    this.processes.set(pkg, devProcess);
    
    // Настройка обработчиков
    this.setupProcessHandlers(devProcess);
    
    // Настройка quiet window
    this.setupQuietWindow(pkg);
  }
  
  /**
   * Парсинг stdout для определения start/finish (primary)
   */
  private parseOutput(pkg: string, line: string): void {
    const process = this.processes.get(pkg);
    if (!process) return;
    
    // Debounce повторных "finished"
    if (this.endPatterns.some(p => p.test(line))) {
      const now = Date.now();
      const last = this.lastEndSignal.get(pkg) || 0;
      
      if (now - last < 200) {
        return; // игнорируем дубликат
      }
      
      this.lastEndSignal.set(pkg, now);
      this.onBuildEnd(pkg);
      return;
    }
    
    // Overlapping builds
    if (this.startPatterns.some(p => p.test(line))) {
      if (process.state === 'building') {
        // Новый start до end — помечаем overlapped
        process.overlapped = true;
        logger.debug("Overlapping build detected", { package: pkg });
      } else {
        this.onBuildStart(pkg);
      }
    }
  }
  
  /**
   * Quiet window для dist/** (fallback, 200-300ms без событий)
   */
  private setupQuietWindow(pkg: string): void {
    const process = this.processes.get(pkg);
    if (!process) return;
    
    // Сбрасываем таймер при каждом событии
    if (process.quietWindowTimer) {
      clearTimeout(process.quietWindowTimer);
    }
    
    process.quietWindowTimer = setTimeout(() => {
      if (process.state === 'building') {
        this.onBuildEnd(pkg);
      }
    }, this.quietWindowMs);
  }
  
  /**
   * Обработка dist/** события
   */
  onDistChange(pkg: string, path: string): void {
    const process = this.processes.get(pkg);
    if (!process) return;
    
    // Если это dist/** файл, сбрасываем quiet window
    if (path.startsWith('dist/') || path.startsWith('dist\\')) {
      this.setupQuietWindow(pkg);
    }
  }
  
  /**
   * Обработка начала билда
   */
  private onBuildStart(pkg: string): void {
    const process = this.processes.get(pkg);
    if (!process) return;
    
    process.state = 'building';
    process.lastBuildStart = Date.now();
    process.overlapped = false;
    
    logger.debug("Build started", { package: pkg });
  }
  
  /**
   * Обработка завершения билда
   */
  private onBuildEnd(pkg: string): void {
    const process = this.processes.get(pkg);
    if (!process) return;
    
    process.state = 'idle';
    process.lastBuildEnd = Date.now();
    
    const duration = process.lastBuildStart 
      ? process.lastBuildEnd! - process.lastBuildStart
      : 0;
    
    this.emit('buildComplete', {
      package: pkg,
      success: true,
      duration,
      overlapped: process.overlapped
    });
    
    logger.debug("Build finished", { 
      package: pkg, 
      duration,
      overlapped: process.overlapped 
    });
  }
  
  /**
   * Остановка процесса
   */
  async stopProcess(pkg: string): Promise<void> {
    const process = this.processes.get(pkg);
    if (!process) return;
    
    logger.info("Stopping dev process", { package: pkg });
    
    // Очищаем таймер
    if (process.quietWindowTimer) {
      clearTimeout(process.quietWindowTimer);
    }
    
    // Останавливаем процесс
    if (!process.process.killed) {
      process.process.kill('SIGTERM');
      
      // Ждем graceful shutdown
      await new Promise(resolve => {
        const timeout = setTimeout(() => {
          process.process.kill('SIGKILL');
          resolve(undefined);
        }, 2000);
        
        process.process.on('exit', () => {
          clearTimeout(timeout);
          resolve(undefined);
        });
      });
    }
    
    this.processes.delete(pkg);
  }
  
  /**
   * Остановка всех процессов
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.processes.keys()).map(pkg => 
      this.stopProcess(pkg)
    );
    await Promise.all(promises);
  }
  
  /**
   * Проверка, запущен ли dev-процесс
   */
  hasDevProcess(pkg: string): boolean {
    return this.processes.has(pkg);
  }
  
  /**
   * Парсинг команды для spawn
   * 
   * @param command - команда из package.json (например, "pnpm run dev" или "tsup --watch")
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
   * Получить состояние процесса
   */
  stateOf(pkg: string): 'starting' | 'idle' | 'building' | null {
    return this.processes.get(pkg)?.state || null;
  }
  
  /**
   * Настройка обработчиков процесса
   */
  private setupProcessHandlers(devProcess: DevProcess): void {
    const { process, package: pkg } = devProcess;
    
    process.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          this.parseOutput(pkg, line);
        }
      }
    });
    
    process.stderr?.on('data', (data) => {
      logger.debug("Dev process stderr", { 
        package: pkg, 
        data: data.toString().trim() 
      });
    });
    
    process.on('error', (err) => {
      logger.error("Dev process error", { package: pkg, error: err.message });
      this.emit('processError', { package: pkg, error: err });
    });
    
    process.on('exit', (code) => {
      logger.info("Dev process exited", { package: pkg, code });
      this.emit('processExit', { package: pkg, code });
      this.processes.delete(pkg);
    });
  }
  
  /**
   * Создание парсера вывода
   */
  private createOutputParser(): OutputParser {
    return {
      startPatterns: [
        /Build started/i,
        /Rebuilding/i,
        /Starting/i,
        /Compiling/i
      ],
      endPatterns: [
        /Build finished/i,
        /Watching for changes/i,
        /Done/i,
        /Compiled successfully/i
      ],
      extractDuration: (line: string) => {
        // Попытка извлечь duration из строки
        const match = line.match(/(\d+(?:\.\d+)?)\s*(?:ms|s)/i);
        if (match && match[0] && match[1]) {
          const value = parseFloat(match[1]);
          return match[0].includes('s') ? value * 1000 : value;
        }
        return null;
      }
    };
  }
  
  /**
   * Паттерны для парсинга (для доступа из parseOutput)
   */
  private get startPatterns(): RegExp[] {
    return [
      /Build started/i,
      /Rebuilding/i,
      /Starting/i,
      /Compiling/i
    ];
  }
  
  private get endPatterns(): RegExp[] {
    return [
      /Build finished/i,
      /Watching for changes/i,
      /Done/i,
      /Compiled successfully/i
    ];
  }
  
  /**
   * Получить статистику
   */
  getStats(): {
    totalProcesses: number;
    processes: Array<{
      package: string;
      state: string;
      uptime?: number;
    }>;
  } {
    const processes = Array.from(this.processes.values()).map(proc => ({
      package: proc.package,
      state: proc.state,
      uptime: proc.lastBuildStart ? Date.now() - proc.lastBuildStart : undefined
    }));
    
    return {
      totalProcesses: this.processes.size,
      processes
    };
  }
}
