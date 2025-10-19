import { logger } from "../utils/logger";
import { watchDevLink as watchDevLinkImpl, DevLinkWatcher } from "../devlink/watch";
import type { WatchOptions, WatchEvent, DryRunResult } from "../devlink/watch";

export type { WatchOptions, WatchEvent, DryRunResult };

/**
 * Start watching providers and refresh consumers on changes
 * 
 * @example
 * ```typescript
 * const watcher = await watch({
 *   rootDir: '/path/to/monorepo',
 *   mode: 'local',
 *   providers: ['@kb-labs/*'],
 * });
 * 
 * watcher.on('event', (event) => {
 *   console.log(event);
 * });
 * 
 * // Later: stop watching
 * await watcher.stop();
 * ```
 */
export async function watch(options: WatchOptions): Promise<DevLinkWatcher> {
  logger.info("Starting DevLink watch", {
    rootDir: options.rootDir,
    mode: options.mode || "auto",
    dryRun: options.dryRun || false,
  });

  try {
    const watcher = await watchDevLinkImpl(options);
    return watcher;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Failed to start watch", { error: errorMessage });
    throw error;
  }
}

export { DevLinkWatcher };

