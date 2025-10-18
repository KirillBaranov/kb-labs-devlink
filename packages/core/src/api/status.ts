import path from "node:path";
import { scanPackages } from "../devlink/scan";
import { loadState, saveState } from "../state";
import { getStatus as getStatusImpl } from "../devlink/status";
import { readJson, exists } from "../utils/fs";
import { logger } from "../utils/logger";
import type { StatusSummary } from "../devlink/status";

export type StatusReport = StatusSummary;

export interface StatusOptions {
  rootDir: string;
  roots?: string[];
}

/**
 * Get current devlink status
 * Auto-scans if no state.json found
 */
export async function status(opts: StatusOptions): Promise<StatusReport> {
  logger.info("Getting status", { rootDir: opts.rootDir });

  let state = await loadState(opts.rootDir);

  // Auto-scan if no state found
  if (!state) {
    logger.info("State not found, running auto-scan (auto-scan)");
    
    // Try to get roots from last-plan.json
    let roots = opts.roots;
    
    if (!roots || roots.length === 0) {
      const lastPlanPath = `${opts.rootDir}/.kb/devlink/last-plan.json`;
      if (await exists(lastPlanPath)) {
        try {
          const lastPlan = await readJson<any>(lastPlanPath);
          // Extract unique roots from plan index
          const planRoots = new Set<string>();
          
          for (const pkgName in lastPlan.index?.packages || {}) {
            const pkg = lastPlan.index.packages[pkgName];
            if (pkg.dir) {
              // Normalize and split path (Windows-safe)
              const normalized = path.resolve(pkg.dir);
              const parts = normalized.split(path.sep);
              const rootIdx = parts.findIndex((p: string) => 
                p === "packages" || p === "apps"
              );
              if (rootIdx > 0) {
                const root = parts.slice(0, rootIdx).join(path.sep);
                planRoots.add(root);
              }
            }
          }
          
          if (planRoots.size > 0) {
            roots = Array.from(planRoots);
            logger.debug("Using roots from last-plan.json", { roots });
          }
        } catch (error) {
          logger.warn("Failed to read last-plan.json", error);
        }
      }
    }
    
    // Fallback to rootDir if no roots found
    if (!roots || roots.length === 0) {
      roots = [opts.rootDir];
    }
    
    try {
      const scanResult = await scanPackages({
        rootDir: opts.rootDir,
        roots,
      } as any);
      state = scanResult.state;
      
      // Save state for future use
      await saveState({
        ...state,
        devlinkVersion: "0.1.0",
        generatedAt: new Date().toISOString(),
      }, opts.rootDir);
      
      logger.info("Auto-scan completed and state saved (auto-scan)", {
        packages: state.packages.length,
      });
    } catch (error) {
      logger.warn("Auto-scan failed", error);
      // Return empty status if scan fails
      return {
        packages: 0,
        links: 0,
        unknown: 0,
        entries: [],
      };
    }
  }

  const result = await getStatusImpl(opts.rootDir, state);

  logger.info("Status retrieved", {
    packages: result.packages,
    links: result.links,
    unknown: result.unknown,
  });

  return result;
}
