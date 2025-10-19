import { join } from "node:path";
import { promises as fsp } from "node:fs";
import { exists, readJson } from "../../utils/fs";
import { logger } from "../../utils/logger";
import type { WatchMode } from "./types";
import type { LastApplyJournal } from "../journal/last-apply";
import type { LockFile } from "../lock/freeze";

/**
 * Detect watch mode from existing devlink state
 * Priority:
 * 1. Explicit mode override (from options)
 * 2. last-apply.json mode field
 * 3. lock.json mode field
 * 4. Scan manifests for link: prefixes
 * 5. Default to "auto"
 */
export async function detectMode(
  rootDir: string,
  explicitMode?: WatchMode
): Promise<WatchMode> {
  // Priority 1: Explicit override
  if (explicitMode) {
    logger.info("Using explicit watch mode", { mode: explicitMode });
    return explicitMode;
  }

  // Priority 2: last-apply.json
  const lastApplyPath = join(rootDir, ".kb", "devlink", "last-apply.json");
  if (await exists(lastApplyPath)) {
    try {
      const journal = await readJson<LastApplyJournal>(lastApplyPath);
      if (journal.mode) {
        const mode = normalizeMode(journal.mode);
        logger.info("Mode detected from last-apply.json", { mode, source: journal.mode });
        return mode;
      }
    } catch (err) {
      logger.debug("Failed to read last-apply.json", { err });
    }
  }

  // Priority 3: lock.json
  const lockPath = join(rootDir, ".kb", "devlink", "lock.json");
  if (await exists(lockPath)) {
    try {
      const lock = await readJson<LockFile>(lockPath);
      if (lock.mode) {
        const mode = normalizeLockMode(lock.mode);
        logger.info("Mode detected from lock.json", { mode, lockMode: lock.mode });
        return mode;
      }

      // Check entries for link/workspace sources
      if (lock.consumers) {
        const hasLink = Object.values(lock.consumers).some((consumer) =>
          Object.values(consumer.deps || {}).some(
            (dep) => dep.source === "link" || dep.source === "workspace"
          )
        );
        if (hasLink) {
          logger.info("Mode detected from lock.json entries", { mode: "local" });
          return "local";
        }
      }
    } catch (err) {
      logger.debug("Failed to read lock.json", { err });
    }
  }

  // Priority 4: Scan manifests for link: prefixes
  const hasLinkPrefix = await scanForLinkPrefixes(rootDir);
  if (hasLinkPrefix) {
    logger.info("Mode detected from manifest scan", { mode: "local" });
    return "local";
  }

  // Default: auto
  logger.info("No mode detected, using default", { mode: "auto" });
  return "auto";
}

/**
 * Normalize journal mode to WatchMode
 */
function normalizeMode(mode: string): WatchMode {
  if (mode === "local" || mode === "yalc") {
    return mode as WatchMode;
  }
  if (mode === "workspace") {
    return "local"; // treat workspace as local for watching
  }
  return "auto";
}

/**
 * Normalize lock.json mode to WatchMode
 */
function normalizeLockMode(mode: "local" | "remote"): WatchMode {
  if (mode === "local") {
    return "local";
  }
  // "remote" → treat as auto (no watch applicable)
  return "auto";
}

/**
 * Scan package.json files for link: prefixes in dependencies
 */
async function scanForLinkPrefixes(rootDir: string): Promise<boolean> {
  try {
    // Look in common package locations
    const searchDirs = ["packages", "apps"];
    
    for (const dir of searchDirs) {
      const fullPath = join(rootDir, dir);
      if (!(await exists(fullPath))) continue;

      const entries = await fsp.readdir(fullPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const pkgJsonPath = join(fullPath, entry.name, "package.json");
        if (!(await exists(pkgJsonPath))) continue;

        try {
          const content = await fsp.readFile(pkgJsonPath, "utf-8");
          if (content.includes('"link:')) {
            return true;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  } catch (err) {
    logger.debug("Failed to scan for link: prefixes", { err });
  }

  return false;
}

