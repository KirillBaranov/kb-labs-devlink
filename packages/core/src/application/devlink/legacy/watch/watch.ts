import { EventEmitter } from "node:events";
import { join, relative } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { logger } from '@devlink/shared/utils/logger';
import { scanPackages } from "../scan/scan";
import { readLastApply } from "../journal/last-apply";
import { detectMode } from "./mode-detector";
import { detectBuildCommands, detectWatchPaths, shouldIgnorePath, getWatchPatterns } from "./build-detector";
import {
  buildReverseDependencyMap,
  getDirectConsumers,
  filterProviders,
  filterConsumers,
} from "./dependency-resolver";
import { SignatureComputer } from "./signature";
import { SelfWriteSuppressor } from "./self-write-suppressor";
import { LoopGuard } from "./loop-guard";
import { BuildOrchestrator } from "./build-orchestrator";
import { ProcessManager } from "./process-manager";
import { RelinkManager, SymlinkStrategy, YalcStrategy, RefreshScriptStrategy } from "./relink-strategies";
import { DevLinkEventEmitter, type AllDevLinkEvents } from "./events";
import type {
  WatchOptions,
  WatchState,
  ProviderConfig,
  ConsumerConfig,
  DryRunResult,
  WatchMode,
} from "./types";
import type { PackageRef } from "../types";

/**
 * Главный класс DevLink Watcher v2
 * Полностью переписанная система watch с фокусом на производительность и устойчивость к циклам
 */
export class DevLinkWatcher extends EventEmitter {
  private options: WatchOptions;
  private state: WatchState | null = null;
  private isShuttingDown = false;
  
  // Модули
  private signatureComputers: Map<string, SignatureComputer> = new Map();
  private selfWriteSuppressor: SelfWriteSuppressor;
  private loopGuard: LoopGuard;
  private buildOrchestrator: BuildOrchestrator;
  private processManager: ProcessManager;
  private relinkManager!: RelinkManager;
  private eventEmitter: DevLinkEventEmitter;
  
  // Watchers для src/** каждого пакета
  private watchers: Map<string, FSWatcher> = new Map();
  
  // Batch coalescing
  private pendingChanges: Map<string, Array<{ path: string; type: string }>> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  
  // Стартовая блокировка (1-2 сек после запуска)
  private startupBlockUntil?: number;
  
  constructor(options: WatchOptions) {
    super();
    this.options = options;
    
    // Инициализация модулей
    this.selfWriteSuppressor = new SelfWriteSuppressor();
    this.loopGuard = new LoopGuard();
    this.buildOrchestrator = new BuildOrchestrator(options.globalConcurrency || 5);
    this.processManager = new ProcessManager();
    this.eventEmitter = new DevLinkEventEmitter(options.json || false, false);
    
    // Настройка relink стратегии
    this.setupRelinkStrategy();
    
    // Настройка graceful shutdown
    this.setupShutdownHandlers();
  }
  
  /**
   * Запуск watch системы
   */
  async start(): Promise<void> {
    if (this.options.dryRun) {
      await this.performDryRun();
      return;
    }
    
    logger.info("Starting DevLink watch v2", { options: this.options });
    
    // 1. Initialize state (scanPackages)
    await this.initialize();
    
    if (!this.state) {
      throw new Error("Failed to initialize watch state");
    }
    
    // 2. Load config (global + per-package overrides)
    await this.loadConfig();
    
    // 3. Preflight validation (с --strict-preflight)
    await this.performPreflightValidation();
    
    // 4. Startup block (1-2 сек)
    this.startupBlockUntil = Date.now() + 2000;
    
    // 5. Start dev processes для пакетов со devCommand
    await this.startDevProcesses();
    
    // 6. Start file watchers для src/** каждого provider
    await this.startFileWatchers();
    
    // 7. Emit ready event
    this.eventEmitter.emitEvent({
      kind: 'devlink.watch.ready',
      timestamp: new Date().toISOString(),
      schemaVersion: '1.0',
      mode: this.state.mode,
      providers: this.state.providers.size,
      consumers: this.state.consumers.size
    });
    
    logger.info("DevLink watch v2 ready", {
      mode: this.state.mode,
      providers: this.state.providers.size,
      consumers: this.state.consumers.size,
    });
  }
  
  /**
   * Остановка watch системы
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) {return;}
    this.isShuttingDown = true;
    
    logger.info("Stopping DevLink watch v2");
    
    // 1. Остановить прием новых задач
    this.watchers.forEach(w => w.close());
    
    // 2. Дождаться завершения текущих билдов
    await this.buildOrchestrator.drain();
    
    // 3. Остановить dev-процессы
    await this.processManager.stopAll();
    
    // 4. Очистить таймеры
    this.debounceTimers.forEach(t => clearTimeout(t));
    this.debounceTimers.clear();
    
    // 5. Emit stopped
    this.eventEmitter.emitEvent({
      kind: 'devlink.watch.stopped',
      timestamp: new Date().toISOString(),
      schemaVersion: '1.0'
    });
    
    logger.info("DevLink watch v2 stopped");
  }
  
  /**
   * Инициализация состояния
   */
  private async initialize(): Promise<void> {
    const { rootDir } = this.options;
    
    // Detect mode
    const mode = await detectMode(rootDir, this.options.mode);
    
    // Try to load from last-apply for existing plan/index
    const lastApply = await readLastApply(rootDir);
    let scanResult;
    
    if (lastApply) {
      logger.info("Loading state from last-apply", { ts: lastApply.ts });
      scanResult = await scanPackages({ rootDir });
    } else {
      logger.info("No last-apply found, performing fresh scan");
      scanResult = await scanPackages({ rootDir });
    }
    
    const { graph, index } = scanResult;
    
    // Filter providers based on options
    const allProviders = Object.keys(index.packages);
    const filteredProviderNames = filterProviders(
      allProviders,
      this.options.providers
    );
    
    // Build reverse dependency map
    const reverseDeps = buildReverseDependencyMap(graph, index);
    
    // Build provider configs
    const providers = new Map<string, ProviderConfig>();
    for (const providerName of filteredProviderNames) {
      const pkgRef = index.packages[providerName];
      if (!pkgRef) {continue;}
      
      const commands = await detectBuildCommands(pkgRef);
      const watchPaths = detectWatchPaths(pkgRef);
      const consumerCount = getDirectConsumers(providerName, reverseDeps).length;
      
      providers.set(providerName, {
        name: providerName,
        dir: pkgRef.dir,
        buildCommand: commands.build,
        devCommand: commands.dev,
        watchPaths,
        pkg: pkgRef,
        timeoutMs: commands.timeoutMs || this.options.buildTimeoutMs || 60000,
        consumerCount
      });
    }
    
    // Get all consumers (packages that depend on our providers)
    const consumerSet = new Set<string>();
    for (const providerName of providers.keys()) {
      const directConsumers = getDirectConsumers(providerName, reverseDeps);
      directConsumers.forEach((c) => consumerSet.add(c));
    }
    
    // Filter consumers based on options
    const filteredConsumerNames = filterConsumers(
      Array.from(consumerSet),
      this.options.consumers
    );
    
    // Build consumer configs
    const consumers = new Map<string, ConsumerConfig>();
    for (const consumerName of filteredConsumerNames) {
      const pkgRef = index.packages[consumerName];
      if (!pkgRef) {continue;}
      
      const hasRefreshScript = await this.hasRefreshScript(pkgRef);
      
      consumers.set(consumerName, {
        name: consumerName,
        dir: pkgRef.dir,
        hasRefreshScript,
        pkg: pkgRef,
      });
    }
    
    this.state = {
      mode,
      providers,
      consumers,
      graph,
      index,
      reverseDeps,
    };
    
    logger.info("Watch state initialized", {
      mode,
      providers: providers.size,
      consumers: consumers.size,
    });
  }
  
  /**
   * Загрузка конфигурации
   */
  private async loadConfig(): Promise<void> {
    // TODO: Реализовать загрузку kb-labs.config.json и per-package overrides
    logger.debug("Config loading not yet implemented");
  }
  
  /**
   * Preflight validation
   */
  private async performPreflightValidation(): Promise<void> {
    if (!this.state) {return;}
    
    const packages = Array.from(this.state.providers.values()).map(provider => ({
      package: provider.name,
      buildCommand: provider.buildCommand,
      devCommand: provider.devCommand,
      source: provider.buildCommand ? 'SCRIPTS' as const : 'NO_BUILD_SCRIPT' as const,
      status: provider.buildCommand ? 'OK' as const : 'SKIP' as const
    }));
    
    this.eventEmitter.emitEvent({
      kind: 'devlink.preflight',
      timestamp: new Date().toISOString(),
      schemaVersion: '1.0',
      packages
    });
    
    // Проверка --strict-preflight
    if (this.options.strictPreflight) {
      const skippedPackages = packages.filter(p => p.status === 'SKIP');
      if (skippedPackages.length > 0) {
        logger.error("Strict preflight failed", { 
          skippedPackages: skippedPackages.length 
        });
        process.exit(1);
      }
    }
  }
  
  /**
   * Запуск dev-процессов
   */
  private async startDevProcesses(): Promise<void> {
    if (!this.state) {return;}
    
    for (const [providerName, provider] of this.state.providers) {
      if (provider.devCommand) {
        await this.processManager.startDevProcess(provider.dir, provider.devCommand);
      }
    }
  }
  
  /**
   * Запуск file watchers
   */
  private async startFileWatchers(): Promise<void> {
    if (!this.state) {return;}
    
    for (const [providerName, provider] of this.state.providers) {
      await this.startProviderWatcher(providerName, provider);
    }
  }
  
  /**
   * Запуск watcher для провайдера
   */
  private async startProviderWatcher(providerName: string, provider: ProviderConfig): Promise<void> {
    const patterns = getWatchPatterns();
    
    // Создаем специфичные пути для отслеживания вместо всей директории
    const watchPaths = patterns.include.map(pattern => 
      join(provider.dir, pattern)
    );
    
    logger.info("Watching paths", { 
      provider: providerName, 
      watchPaths: watchPaths,
      providerDir: provider.dir
    });
    
    const watcher = chokidar.watch(watchPaths, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50
      },
      alwaysStat: true,
      // Ограничиваем количество файлов для предотвращения EMFILE
      persistent: true,
      usePolling: false, // Используем fs.watch вместо polling для лучшей производительности
      ignored: [
        ...patterns.exclude,
        '**/.git/**',
        '**/.idea/**',
        '**/.vscode/**',
        '**/node_modules/**', // Дополнительная защита
        '**/dist/**', // Дополнительная защита
        '**/.yalc/**', // Дополнительная защита
        '**/coverage/**' // Дополнительная защита
      ]
    });
    
    watcher.on("change", (filePath: string) => {
      this.handleFileChange(providerName, filePath, 'change');
    });
    
    watcher.on("add", (filePath: string) => {
      this.handleFileChange(providerName, filePath, 'add');
    });
    
    watcher.on("unlink", (filePath: string) => {
      this.handleFileChange(providerName, filePath, 'unlink');
    });
    
    watcher.on("error", (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes('EMFILE') || errorMessage.includes('too many open files')) {
        logger.error("EMFILE: Too many open files", { 
          provider: providerName, 
          error: errorMessage,
          hint: "Try increasing ulimit -n or reducing the number of watched files"
        });
        
        // Emit специальное событие для EMFILE
        this.eventEmitter.emitEvent({
          kind: 'devlink.config.error',
          timestamp: new Date().toISOString(),
          schemaVersion: '1.0',
          message: `EMFILE: Too many open files for ${providerName}`,
          path: provider.dir
        });
      } else {
        logger.error("Watcher error", { provider: providerName, error: errorMessage });
      }
    });
    
    this.watchers.set(providerName, watcher);
    
    logger.debug("Provider watcher started", {
      provider: providerName,
      watchPaths: watchPaths,
    });
  }
  
  /**
   * Обработка изменения файла
   */
  private async handleFileChange(pkg: string, path: string, type: string): Promise<void> {
    // 0. Startup block check
    if (this.startupBlockUntil && Date.now() < this.startupBlockUntil) {
      logger.debug("Ignoring change during startup block", { pkg, path });
      return;
    }
    
    // 1. Check self-write suppression
    const provider = this.state?.providers.get(pkg);
    if (!provider) {return;}
    
    const relPath = relative(provider.dir, path);
    if (this.selfWriteSuppressor.isSuppressed(relPath)) {
      logger.debug("Ignoring self-write", { pkg, path: relPath });
      return;
    }
    
    // 2. Accumulate in pendingChanges
    if (!this.pendingChanges.has(pkg)) {
      this.pendingChanges.set(pkg, []);
    }
    this.pendingChanges.get(pkg)!.push({ path: relPath, type });
    
    // 3. Debounce (perPackageDebounceMs)
    this.clearDebounceTimer(pkg);
    const debounceMs = this.options.perPackageDebounceMs || 200;
    const timer = setTimeout(() => {
      this.processPendingChanges(pkg);
    }, debounceMs);
    this.debounceTimers.set(pkg, timer);
  }
  
  /**
   * Обработка накопленных изменений
   */
  private async processPendingChanges(pkg: string): Promise<void> {
    const changes = this.pendingChanges.get(pkg) || [];
    this.pendingChanges.delete(pkg);
    
    if (changes.length === 0) {return;}
    
    // 1. Apply delta to signature computer
    const computer = this.getSignatureComputer(pkg);
    const deltas = changes.map(change => ({
      path: change.path,
      type: change.type as 'add' | 'change' | 'delete'
    }));
    computer.applyDelta(deltas);
    
    // 2. Check loop guard
    const loopGuardResult = this.loopGuard.recordBuild(pkg);
    if (!loopGuardResult.allowed) {
      logger.debug("Build blocked by loop guard", { 
        pkg, 
        reason: loopGuardResult.reason,
        cooldownMs: loopGuardResult.cooldownMs 
      });
      return;
    }
    
    // 3. Compute signature (fast/slow depending on degraded mode)
    const useSlowSignature = this.loopGuard.shouldUseDegradedHashing(pkg);
    const signature = useSlowSignature 
      ? await computer.computeSlow()
      : computer.computeFast();
    
    // 4. Check if changed vs lastSuccess
    const lastSuccess = this.buildOrchestrator['lastSuccess'].get(pkg);
    if (lastSuccess && !computer.hasChanged(lastSuccess, signature)) {
      this.eventEmitter.emitEvent({
        kind: 'devlink.info.skipped_no_change',
        timestamp: new Date().toISOString(),
        schemaVersion: '1.0',
        package: pkg,
        reason: 'signature unchanged'
      });
      return;
    }
    
    // 5. Enqueue build (with cancel in-flight)
    const provider = this.state?.providers.get(pkg);
    if (!provider) {return;}
    
    const task = {
      package: pkg,
      packageDir: provider.dir,
      ticketId: this.generateTicketId(),
      priority: provider.consumerCount,
      changedFiles: changes.map(c => c.path),
      signature,
      type: provider.devCommand ? 'long-running' as const : 'one-shot' as const,
      command: provider.devCommand || provider.buildCommand || 'pnpm run build',
      timeoutMs: provider.timeoutMs,
      enqueuedAt: Date.now()
    };
    
    await this.buildOrchestrator.enqueueBuild(task);
  }
  
  /**
   * Получение или создание SignatureComputer для пакета
   */
  private getSignatureComputer(pkg: string): SignatureComputer {
    if (!this.signatureComputers.has(pkg)) {
      const provider = this.state?.providers.get(pkg);
      if (!provider) {throw new Error(`Provider not found: ${pkg}`);}
      
      this.signatureComputers.set(pkg, new SignatureComputer(provider.dir));
    }
    return this.signatureComputers.get(pkg)!;
  }
  
  /**
   * Очистка debounce таймера
   */
  private clearDebounceTimer(pkg: string): void {
    const timer = this.debounceTimers.get(pkg);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(pkg);
    }
  }
  
  /**
   * Настройка relink стратегии
   */
  private setupRelinkStrategy(): void {
    if (!this.state) {return;}
    
    let strategy;
    switch (this.state.mode) {
      case 'local':
        strategy = new SymlinkStrategy();
        break;
      case 'yalc':
        strategy = new YalcStrategy();
        break;
      default:
        strategy = new RefreshScriptStrategy();
    }
    
    this.relinkManager = new RelinkManager(strategy, this.selfWriteSuppressor);
  }
  
  /**
   * Настройка graceful shutdown handlers
   */
  private setupShutdownHandlers(): void {
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }
  
  /**
   * Проверка наличия devlink:refresh скрипта
   */
  private async hasRefreshScript(pkgRef: PackageRef): Promise<boolean> {
    const manifest = pkgRef.manifest || pkgRef.pkg;
    return !!(manifest as any)?.scripts?.["devlink:refresh"];
  }
  
  /**
   * Генерация ticket ID
   */
  private generateTicketId(): string {
    return `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Dry run
   */
  private async performDryRun(): Promise<void> {
    await this.initialize();
    
    if (!this.state) {
      throw new Error("Failed to initialize state for dry run");
    }
    
    const result: DryRunResult = {
      mode: this.state.mode,
      providers: Array.from(this.state.providers.values()).map((p) => ({
        name: p.name,
        dir: p.dir,
        buildCommand: p.buildCommand,
        devCommand: p.devCommand,
        watchPaths: p.watchPaths,
      })),
      consumers: Array.from(this.state.consumers.values()).map((c) => ({
        name: c.name,
        dir: c.dir,
        hasRefreshScript: c.hasRefreshScript,
      })),
      dependencies: Array.from(this.state.providers.keys()).map((providerName) => ({
        provider: providerName,
        consumers: getDirectConsumers(providerName, this.state!.reverseDeps),
      })),
    };
    
    this.eventEmitter.emitEvent({
      kind: 'devlink.dryrun',
      timestamp: new Date().toISOString(),
      schemaVersion: '1.0',
      ...result
    });
  }
}

/**
 * Main watch function (public API)
 */
export async function watchDevLink(options: WatchOptions): Promise<DevLinkWatcher> {
  const watcher = new DevLinkWatcher(options);
  await watcher.start();
  return watcher;
}
