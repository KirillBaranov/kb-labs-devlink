import { promises as fsp } from "node:fs";
import path from "node:path";
import { loadState } from "../../state";
import { readJson, exists } from "../../utils/fs";
import { logger } from "../../utils/logger";
import type { DevlinkState, PackageJson } from "../../types";
import type { LockFile } from "../lock/freeze";

export interface StatusEntry {
  consumer: string;
  dep: string;
  source: "yalc" | "npm" | "workspace" | "unknown";
}

export interface StatusSummary {
  packages: number;
  links: number;
  unknown: number;
  entries: StatusEntry[];
  lockStats?: {
    consumers: number;
    totalDeps: number;
    workspaceDeps: number;
    linkDeps: number;
    npmDeps: number;
    lockVersion?: string;
    hash?: string;
  };
}

/**
 * Read lock file statistics
 */
async function readLockStats(rootDir: string) {
  const lockPath = path.join(rootDir, ".kb", "devlink", "lock.json");
  
  try {
    const fileExists = await exists(lockPath);
    if (!fileExists) return null;
    
    const content = await fsp.readFile(lockPath, "utf-8");
    const lock = JSON.parse(content) as LockFile;
    
    if (!lock.consumers) return null;
    
    return {
      consumers: Object.keys(lock.consumers).length,
      totalDeps: Object.values(lock.consumers).reduce(
        (sum, c) => sum + Object.keys(c.deps).length,
        0
      ),
      workspaceDeps: countBySource(lock, "workspace"),
      linkDeps: countBySource(lock, "link"),
      npmDeps: countBySource(lock, "npm"),
      lockVersion: lock.meta?.lockVersion,
      hash: lock.meta?.hash,
    };
  } catch (err) {
    logger.debug("Failed to read lock stats", { err });
    return null;
  }
}

/**
 * Count dependencies by source type
 */
function countBySource(lock: LockFile, source: string): number {
  let count = 0;
  for (const consumer of Object.values(lock.consumers)) {
    for (const entry of Object.values(consumer.deps)) {
      if (entry.source === source) count++;
    }
  }
  return count;
}

/**
 * Check if a package is linked via yalc by checking yalc.lock
 */
async function checkYalcLink(consumerDir: string, depName: string): Promise<boolean> {
  const yalcLockPath = path.join(consumerDir, "yalc.lock");
  if (!(await exists(yalcLockPath))) {
    return false;
  }

  try {
    const yalcLock = await readJson<any>(yalcLockPath);
    return !!yalcLock.packages?.[depName];
  } catch {
    return false;
  }
}

/**
 * Get current devlink status
 */
export async function getStatus(
  rootDir: string,
  state?: DevlinkState
): Promise<StatusSummary> {
  logger.info("Getting devlink status", { rootDir });

  // Use provided state or load from disk
  if (!state) {
    const loadedState = await loadState(rootDir);
    state = loadedState ?? undefined;
  }

  if (!state) {
    logger.warn("No state available");
    const lockStats = await readLockStats(rootDir);
    return {
      packages: 0,
      links: 0,
      unknown: 0,
      entries: [],
      lockStats: lockStats ?? undefined,
    };
  }

  const entries: StatusEntry[] = [];
  let linksCount = 0;
  let unknownCount = 0;

  // Get all local package names for filtering
  const localPackageNames = new Set(state.packages.map(p => p.name));

  // Check each package for dependencies
  for (const pkg of state.packages) {
    try {
      const pkgJsonPath = path.join(pkg.pathAbs, "package.json");
      if (!(await exists(pkgJsonPath))) {
        continue;
      }

      const pkgJson = await readJson<PackageJson>(pkgJsonPath);
      const allDeps = {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
      };

      // Check each dependency
      for (const [depName, depVersion] of Object.entries(allDeps)) {
        // Only track local packages (those in our workspace)
        if (!localPackageNames.has(depName)) {
          continue;
        }

        // Determine source
        let source: StatusEntry["source"] = "unknown";

        // Check if it's a yalc link
        const isYalc = await checkYalcLink(pkg.pathAbs, depName);
        if (isYalc) {
          source = "yalc";
          linksCount++;
        }
        // Check if it's a workspace link
        else if (typeof depVersion === "string" && depVersion.startsWith("workspace:")) {
          source = "workspace";
          linksCount++;
        }
        // Check if it's from npm (version string without workspace:)
        else if (typeof depVersion === "string" && !depVersion.startsWith("workspace:")) {
          source = "npm";
        }
        else {
          unknownCount++;
        }

        entries.push({
          consumer: pkg.name,
          dep: depName,
          source,
        });
      }
    } catch (error) {
      logger.warn(`Failed to check status for ${pkg.name}`, error);
    }
  }

  // Get lock stats
  const lockStats = await readLockStats(rootDir);

  return {
    packages: state.packages.length,
    links: linksCount,
    unknown: unknownCount,
    entries,
    lockStats: lockStats ?? undefined,
  };
}

