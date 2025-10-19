import { readJson, writeJson, exists } from "../../utils/fs";
import { logger } from "../../utils/logger";
import type { DevLinkPlan, LinkAction, ManifestPatch } from "../types";

export interface LastApplyJournal {
  rootDir: string;
  ts: string; // ISO timestamp
  mode: string;
  actions: LinkAction[];
  manifestPatches?: ManifestPatch[];
  backupDir?: string;  // Path to backup directory for restore
  backupTimestamp?: string;  // ISO timestamp of backup
  status?: "pending" | "completed";  // Operation status
  undone?: boolean;  // Marked true after undo instead of deletion
}

/**
 * Write last-apply journal for undo functionality
 */
export async function writeLastApply(
  plan: DevLinkPlan,
  executed: LinkAction[],
  manifestPatches?: ManifestPatch[],
  backupDir?: string
): Promise<void> {
  const ts = new Date().toISOString();
  const timestamp = ts.replace(/:/g, "-");
  const backupPath = backupDir || `${plan.rootDir}/.kb/devlink/backups/${timestamp}`;
  
  const journal: LastApplyJournal = {
    rootDir: plan.rootDir,
    ts,
    mode: plan.mode,
    actions: executed,
    manifestPatches,
    backupDir: backupPath,
  };

  const journalPath = `${plan.rootDir}/.kb/devlink/last-apply.json`;
  await writeJson(journalPath, journal);

  logger.debug("Last-apply journal written", {
    path: journalPath,
    actions: executed.length,
    manifestPatches: manifestPatches?.length || 0,
    backupDir: backupPath,
  });
}

/**
 * Write last-apply journal directly (for undo marking)
 */
export async function writeLastApplyJournal(
  journal: LastApplyJournal
): Promise<void> {
  const journalPath = `${journal.rootDir}/.kb/devlink/last-apply.json`;
  await writeJson(journalPath, journal);
  
  logger.debug("Last-apply journal updated", {
    path: journalPath,
    undone: journal.undone,
  });
}

/**
 * Read last-apply journal
 */
export async function readLastApply(
  rootDir: string
): Promise<LastApplyJournal | null> {
  const journalPath = `${rootDir}/.kb/devlink/last-apply.json`;

  if (!(await exists(journalPath))) {
    return null;
  }

  try {
    const journal = await readJson<LastApplyJournal>(journalPath);
    return journal;
  } catch (error) {
    logger.warn("Failed to read last-apply journal", error);
    return null;
  }
}

export interface LastFreezeJournal {
  operation: "freeze";
  ts: string;
  rootDir: string;
  lockPath: string;
  backupDir: string;
  packagesCount: number;
  replaced?: boolean;
  pruned?: string[];  // List of pruned package names
  pin: "exact" | "caret";
  undone?: boolean;  // Marked true after undo instead of deletion
}

/**
 * Write last-freeze journal for undo functionality
 */
export async function writeLastFreeze(
  journal: LastFreezeJournal
): Promise<void> {
  const journalPath = `${journal.rootDir}/.kb/devlink/last-freeze.json`;
  await writeJson(journalPath, journal);
  
  logger.debug("Last-freeze journal written", {
    path: journalPath,
    packagesCount: journal.packagesCount,
    pruned: journal.pruned?.length || 0,
  });
}

/**
 * Read last-freeze journal
 */
export async function readLastFreeze(
  rootDir: string
): Promise<LastFreezeJournal | null> {
  const journalPath = `${rootDir}/.kb/devlink/last-freeze.json`;
  
  if (!(await exists(journalPath))) {
    return null;
  }
  
  try {
    const journal = await readJson<LastFreezeJournal>(journalPath);
    return journal;
  } catch (error) {
    logger.warn("Failed to read last-freeze journal", error);
    return null;
  }
}

