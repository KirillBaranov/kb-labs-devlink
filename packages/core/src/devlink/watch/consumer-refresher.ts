import { runCommand } from "../../utils/runCommand";
import { logger } from "../../utils/logger";
import type { WatchMode, ProviderConfig, ConsumerConfig } from "./types";

export interface RefreshResult {
  ok: boolean;
  refreshedConsumers: string[];
  errors: Array<{ consumer: string; error: string }>;
  duration: number;
}

/**
 * Refresh consumers after provider build
 * Local mode: run devlink:refresh script if exists, otherwise log
 * Yalc mode: yalc publish in provider, then yalc update in each consumer
 */
export async function refreshConsumers(
  provider: ProviderConfig,
  consumers: ConsumerConfig[],
  mode: WatchMode
): Promise<RefreshResult> {
  const startTime = Date.now();
  const refreshedConsumers: string[] = [];
  const errors: Array<{ consumer: string; error: string }> = [];

  if (consumers.length === 0) {
    logger.debug("No consumers to refresh", { provider: provider.name });
    return {
      ok: true,
      refreshedConsumers: [],
      errors: [],
      duration: Date.now() - startTime,
    };
  }

  logger.info("Refreshing consumers", {
    provider: provider.name,
    consumers: consumers.length,
    mode,
  });

  if (mode === "yalc") {
    // Yalc mode: publish provider, then update all consumers
    try {
      await refreshYalcMode(provider, consumers);
      refreshedConsumers.push(...consumers.map((c) => c.name));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("Yalc refresh failed", { provider: provider.name, error: errorMsg });
      errors.push({ consumer: "all", error: errorMsg });
    }
  } else {
    // Local mode: run devlink:refresh script for each consumer if available
    for (const consumer of consumers) {
      try {
        await refreshLocalMode(consumer);
        refreshedConsumers.push(consumer.name);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn("Consumer refresh failed", {
          consumer: consumer.name,
          error: errorMsg,
        });
        errors.push({ consumer: consumer.name, error: errorMsg });
      }
    }
  }

  const duration = Date.now() - startTime;
  const ok = errors.length === 0;

  logger.info("Consumers refresh completed", {
    provider: provider.name,
    refreshed: refreshedConsumers.length,
    errors: errors.length,
    duration,
  });

  return {
    ok,
    refreshedConsumers,
    errors,
    duration,
  };
}

/**
 * Refresh in yalc mode: publish provider and update all consumers
 */
async function refreshYalcMode(
  provider: ProviderConfig,
  consumers: ConsumerConfig[]
): Promise<void> {
  // Step 1: yalc publish in provider
  logger.debug("Running yalc publish", { provider: provider.name });
  await runCommand("yalc publish", {
    cwd: provider.dir,
    stdio: "pipe", // capture output to avoid noise
    allowFail: false,
  });

  // Step 2: yalc update in each consumer (batched for efficiency)
  const batchSize = 5;
  for (let i = 0; i < consumers.length; i += batchSize) {
    const batch = consumers.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (consumer) => {
        logger.debug("Running yalc update", {
          consumer: consumer.name,
          provider: provider.name,
        });
        
        await runCommand(`yalc update ${provider.name}`, {
          cwd: consumer.dir,
          stdio: "pipe",
          allowFail: false,
        });
      })
    );
  }

  logger.info("Yalc refresh completed", {
    provider: provider.name,
    consumers: consumers.length,
  });
}

/**
 * Refresh in local mode: run devlink:refresh script if available
 */
async function refreshLocalMode(consumer: ConsumerConfig): Promise<void> {
  if (consumer.hasRefreshScript) {
    logger.debug("Running devlink:refresh script", { consumer: consumer.name });
    
    await runCommand("pnpm run devlink:refresh", {
      cwd: consumer.dir,
      stdio: "pipe",
      allowFail: false,
    });
    
    logger.info("Consumer refreshed (script)", { consumer: consumer.name });
  } else {
    // No script, just log (rely on consumer's own dev watchers)
    logger.info("Consumer refreshed (no-op, relying on dev watcher)", {
      consumer: consumer.name,
    });
  }
}

