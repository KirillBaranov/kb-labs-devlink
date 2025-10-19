import { EventEmitter } from "node:events";
import { join, relative } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import PQueue from "p-queue";
import { logger } from "../../utils/logger";
import { runCommand } from "../../utils/runCommand";
import { scanPackages } from "../scan/scan";
import { readLastApply } from "../journal/last-apply";
import { exists } from "../../utils/fs";
import { detectMode } from "./mode-detector";
import { detectBuildCommand, detectWatchPaths, shouldIgnorePath } from "./build-detector";
import {
  buildReverseDependencyMap,
  getDirectConsumers,
  filterProviders,
  filterConsumers,
} from "./dependency-resolver";
import { refreshConsumers } from "./consumer-refresher";
import type {
  WatchOptions,
  WatchState,
  WatchEvent,
  ProviderConfig,
  ConsumerConfig,
  DryRunResult,
  WatchMode,
} from "./types";
import type { PackageRef } from "../types";

export class DevLinkWatcher extends EventEmitter {
  private state: WatchState | null = null;
  private watchers: Map<string, FSWatcher> = new Map();
  private buildQueue: PQueue;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private reverseDeps: Map<string, string[]> = new Map();
  private isShuttingDown = false;

  constructor(private options: WatchOptions) {
    super();
    this.buildQueue = new PQueue({
      concurrency: options.concurrency || 4,
    });
  }

  /**
   * Start watching
   */
  async start(): Promise<void> {
    if (this.options.dryRun) {
      await this.performDryRun();
      return;
    }

    logger.info("Starting DevLink watch", { options: this.options });

    // Initialize state
    await this.initialize();

    if (!this.state) {
      throw new Error("Failed to initialize watch state");
    }

    // Start file watchers for all providers
    for (const [providerName, provider] of this.state.providers) {
      await this.startProviderWatcher(providerName, provider);
    }

    this.emitEvent({
      type: "ready",
      ts: new Date().toISOString(),
      mode: this.state.mode,
      providers: this.state.providers.size,
      consumersCount: this.state.consumers.size,
    });

    logger.info("DevLink watch ready", {
      mode: this.state.mode,
      providers: this.state.providers.size,
      consumers: this.state.consumers.size,
    });
  }

  /**
   * Stop watching and cleanup
   */
  async stop(): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    logger.info("Stopping DevLink watch");

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Wait for in-flight builds
    await this.buildQueue.onIdle();

    // Close all watchers
    for (const [name, watcher] of this.watchers) {
      logger.debug("Closing watcher", { provider: name });
      await watcher.close();
    }
    this.watchers.clear();

    this.emitEvent({
      type: "stopped",
      ts: new Date().toISOString(),
    });

    logger.info("DevLink watch stopped");
  }

  /**
   * Initialize watch state
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
      // Perform fresh scan to get current state
      scanResult = await scanPackages({ rootDir });
    } else {
      // No last-apply, perform fresh scan
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
    this.reverseDeps = buildReverseDependencyMap(graph, index);

    // Build provider configs
    const providers = new Map<string, ProviderConfig>();
    for (const providerName of filteredProviderNames) {
      const pkgRef = index.packages[providerName];
      if (!pkgRef) continue;

      const buildCommand = await detectBuildCommand(pkgRef);
      const watchPaths = detectWatchPaths(pkgRef);

      providers.set(providerName, {
        name: providerName,
        dir: pkgRef.dir,
        buildCommand,
        watchPaths,
        pkg: pkgRef,
      });
    }

    // Get all consumers (packages that depend on our providers)
    const consumerSet = new Set<string>();
    for (const providerName of providers.keys()) {
      const directConsumers = getDirectConsumers(providerName, this.reverseDeps);
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
      if (!pkgRef) continue;

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
      inFlightBuilds: new Set(),
      lastBuildStartTime: new Map(),
      lastBuildEndTime: new Map(),
    };

    logger.info("Watch state initialized", {
      mode,
      providers: providers.size,
      consumers: consumers.size,
    });
  }

  /**
   * Check if package has devlink:refresh script
   */
  private async hasRefreshScript(pkgRef: PackageRef): Promise<boolean> {
    const manifest = pkgRef.manifest || pkgRef.pkg;
    return !!(manifest as any)?.scripts?.["devlink:refresh"];
  }

  /**
   * Start file watcher for a provider
   */
  private async startProviderWatcher(
    providerName: string,
    provider: ProviderConfig
  ): Promise<void> {
    const watchPaths = provider.watchPaths.map((p) => join(provider.dir, p));

    const watcher = chokidar.watch(watchPaths, {
      ignored: (path: string) => {
        const rel = relative(provider.dir, path);
        return shouldIgnorePath(rel);
      },
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    watcher.on("change", (filePath: string) => {
      this.handleFileChange(providerName, provider, filePath);
    });

    watcher.on("add", (filePath: string) => {
      this.handleFileChange(providerName, provider, filePath);
    });

    watcher.on("error", (error: Error) => {
      logger.error("Watcher error", { provider: providerName, error: error.message });
      this.emitEvent({
        type: "error",
        ts: new Date().toISOString(),
        pkg: providerName,
        error: error.message,
      });
    });

    this.watchers.set(providerName, watcher);

    logger.debug("Provider watcher started", {
      provider: providerName,
      paths: watchPaths,
    });
  }

  /**
   * Handle file change event with debouncing
   */
  private handleFileChange(
    providerName: string,
    provider: ProviderConfig,
    filePath: string
  ): void {
    if (this.isShuttingDown) return;

    const relPath = relative(provider.dir, filePath);

    // Loop protection: ignore dist/ changes shortly after build
    if (relPath.startsWith("dist/") || relPath.startsWith("dist\\")) {
      const lastBuildEnd = this.state?.lastBuildEndTime.get(providerName) || 0;
      const timeSinceBuild = Date.now() - lastBuildEnd;
      
      if (timeSinceBuild < 500) {
        logger.debug("Ignoring dist/ change (recent build)", {
          provider: providerName,
          file: relPath,
          timeSinceBuild,
        });
        return;
      }
    }

    this.emitEvent({
      type: "changed",
      ts: new Date().toISOString(),
      pkg: providerName,
      files: [relPath],
    });

    // Clear existing debounce timer
    const existingTimer = this.debounceTimers.get(providerName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const debounceMs = this.options.debounce || 200;
    const timer = setTimeout(() => {
      this.debounceTimers.delete(providerName);
      this.triggerBuild(providerName, provider);
    }, debounceMs);

    this.debounceTimers.set(providerName, timer);
  }

  /**
   * Trigger build for provider
   */
  private async triggerBuild(
    providerName: string,
    provider: ProviderConfig
  ): Promise<void> {
    if (!this.state) return;

    // Check if already building (prevent concurrent builds of same provider)
    if (this.state.inFlightBuilds.has(providerName)) {
      logger.debug("Build already in progress, skipping", { provider: providerName });
      return;
    }

    // Add to queue
    this.buildQueue.add(async () => {
      await this.executeBuild(providerName, provider);
    });
  }

  /**
   * Execute build for provider
   */
  private async executeBuild(
    providerName: string,
    provider: ProviderConfig
  ): Promise<void> {
    if (!this.state) return;
    if (this.isShuttingDown) return;

    // Mark as building
    this.state.inFlightBuilds.add(providerName);
    this.state.lastBuildStartTime.set(providerName, Date.now());

    const buildStartTime = Date.now();

    this.emitEvent({
      type: "building",
      ts: new Date().toISOString(),
      pkg: providerName,
      command: provider.buildCommand,
    });

    logger.info("Building provider", {
      provider: providerName,
      command: provider.buildCommand,
    });

    try {
      if (!this.options.noBuild) {
        await runCommand(provider.buildCommand, {
          cwd: provider.dir,
          stdio: "pipe", // capture to avoid noise
          allowFail: false,
        });
      } else {
        logger.debug("Skipping build (--no-build)", { provider: providerName });
      }

      const buildDuration = Date.now() - buildStartTime;
      this.state.lastBuildEndTime.set(providerName, Date.now());

      this.emitEvent({
        type: "built",
        ts: new Date().toISOString(),
        pkg: providerName,
        duration: buildDuration,
      });

      logger.info("Build completed", {
        provider: providerName,
        duration: buildDuration,
      });

      // Refresh consumers
      await this.refreshProviderConsumers(providerName, provider);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      
      this.emitEvent({
        type: "build-error",
        ts: new Date().toISOString(),
        pkg: providerName,
        error: errorMsg,
      });

      logger.error("Build failed", {
        provider: providerName,
        error: errorMsg,
      });

      if (this.options.exitOnError) {
        await this.stop();
        process.exit(1);
      }
    } finally {
      // Remove from in-flight
      this.state.inFlightBuilds.delete(providerName);
    }
  }

  /**
   * Refresh consumers after provider build
   */
  private async refreshProviderConsumers(
    providerName: string,
    provider: ProviderConfig
  ): Promise<void> {
    if (!this.state) return;

    // Get direct consumers for this provider
    const directConsumerNames = getDirectConsumers(providerName, this.reverseDeps);
    
    // Filter to only consumers we're tracking
    const consumersToRefresh = directConsumerNames
      .map((name) => this.state!.consumers.get(name))
      .filter((c): c is ConsumerConfig => c !== undefined);

    if (consumersToRefresh.length === 0) {
      logger.debug("No consumers to refresh", { provider: providerName });
      return;
    }

    this.emitEvent({
      type: "refreshing",
      ts: new Date().toISOString(),
      pkg: providerName,
      consumers: consumersToRefresh.map((c) => c.name),
    });

    const result = await refreshConsumers(
      provider,
      consumersToRefresh,
      this.state.mode
    );

    if (result.ok) {
      this.emitEvent({
        type: "refreshed",
        ts: new Date().toISOString(),
        pkg: providerName,
        consumers: result.refreshedConsumers,
        duration: result.duration,
      });
    } else {
      this.emitEvent({
        type: "refresh-error",
        ts: new Date().toISOString(),
        pkg: providerName,
        error: `Failed to refresh ${result.errors.length} consumers`,
      });
    }
  }

  /**
   * Emit watch event
   */
  private emitEvent(event: WatchEvent): void {
    this.emit("event", event);
  }

  /**
   * Perform dry run (show what would be watched)
   */
  private async performDryRun(): Promise<void> {
    logger.info("Performing dry run");

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
        watchPaths: p.watchPaths,
      })),
      consumers: Array.from(this.state.consumers.values()).map((c) => ({
        name: c.name,
        dir: c.dir,
        hasRefreshScript: c.hasRefreshScript,
      })),
      dependencies: Array.from(this.state.providers.keys()).map((providerName) => ({
        provider: providerName,
        consumers: getDirectConsumers(providerName, this.reverseDeps),
      })),
    };

    // Emit as event for CLI to handle
    this.emit("dryrun", result);

    logger.info("Dry run completed", {
      providers: result.providers.length,
      consumers: result.consumers.length,
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

