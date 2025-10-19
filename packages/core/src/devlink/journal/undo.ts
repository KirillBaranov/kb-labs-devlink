import { promises as fsp } from "node:fs";
import path, { join } from "node:path";
import { runCommand } from "../../utils/runCommand";
import { logger } from "../../utils/logger";
import { readLastApply, readLastFreeze, writeLastFreeze, writeLastApplyJournal, type LastApplyJournal } from "./last-apply";
import { readJson, exists, writeJson } from "../../utils/fs";
import type { LockFile } from "../lock/freeze";

/**
 * Undo last apply by restoring package.json files from backup
 */
export async function undoLastApply(
  rootDir: string,
  opts: { dryRun?: boolean } = {}
): Promise<void> {
  const journal = await readLastApply(rootDir);

  if (!journal) {
    throw new Error("No last-apply journal found. Nothing to undo.");
  }
  
  if (journal.undone) {
    throw new Error("Apply operation already undone");
  }

  logger.info("Undoing last apply", {
    actions: journal.actions.length,
    manifestPatches: journal.manifestPatches?.length || 0,
    backupDir: journal.backupDir,
    dryRun: opts.dryRun
  });

  // Check if backup directory exists
  if (!journal.backupDir || !(await exists(journal.backupDir))) {
    throw new Error(
      `Cannot undo apply: backup directory not found at ${journal.backupDir}. ` +
      `Backups may have been deleted or never created.`
    );
  }

  // Restore package.json files from backups
  const manifestPatches = journal.manifestPatches || [];
  const restoredCount = new Set<string>();

  for (const patch of manifestPatches) {
    const { manifestPath } = patch;
    
    // Calculate backup path - try new structure (type.apply/manifests/) first, then old structure
    const relativePath = path.relative(rootDir, manifestPath);
    const backupPathNew = join(journal.backupDir, "type.apply", "manifests", relativePath);
    const backupPathOld = join(journal.backupDir, relativePath);
    
    let backupPath: string;
    if (await exists(backupPathNew)) {
      backupPath = backupPathNew;
    } else if (await exists(backupPathOld)) {
      backupPath = backupPathOld;
    } else {
      logger.warn(`Backup not found for ${relativePath}, skipping`, { 
        triedNew: backupPathNew,
        triedOld: backupPathOld 
      });
      continue;
    }

    if (opts.dryRun) {
      logger.info(`[dry-run] Would restore ${relativePath} from backup`, { backupPath });
      continue;
    }

    try {
      // Restore file from backup
      const backupContent = await fsp.readFile(backupPath, "utf-8");
      await fsp.writeFile(manifestPath, backupContent, "utf-8");
      
      restoredCount.add(manifestPath);
      logger.debug(`Restored ${relativePath} from backup`);
    } catch (error) {
      logger.warn(`Failed to restore ${relativePath}`, error);
      // Continue with other files
    }
  }

  // Mark journal as undone instead of deleting (for history tracking)
  if (!opts.dryRun) {
    await writeLastApplyJournal({
      ...journal,
      undone: true,
    });
  }

  logger.info("Undo completed", {
    restoredFiles: restoredCount.size,
    totalPatches: manifestPatches.length,
  });
}

/**
 * Undo last freeze operation by restoring from timestamped backup
 */
async function undoLastFreeze(
  rootDir: string,
  opts: { dryRun?: boolean }
): Promise<{ reverted: number; details: any }> {
  const journal = await readLastFreeze(rootDir);
  
  if (!journal) {
    throw new Error("No freeze journal found");
  }
  
  if (journal.undone) {
    throw new Error("Freeze operation already undone");
  }

  // Check for lock.json in new structure (type.freeze/) or old structure (root)
  const backupLockPathNew = join(journal.backupDir, "type.freeze", "lock.json");
  const backupLockPathOld = join(journal.backupDir, "lock.json");
  
  let backupLockPath: string;
  if (await exists(backupLockPathNew)) {
    backupLockPath = backupLockPathNew;
  } else if (await exists(backupLockPathOld)) {
    backupLockPath = backupLockPathOld;
  } else {
    throw new Error(`Cannot undo freeze: backup file not found at ${backupLockPathNew} or ${backupLockPathOld}`);
  }

  if (opts.dryRun) {
    logger.info("[dry-run] Would restore lock.json from backup", {
      from: backupLockPath,
      to: journal.lockPath,
      packagesCount: journal.packagesCount,
      pruned: journal.pruned?.length || 0,
    });
    return {
      reverted: journal.packagesCount,
      details: {
        restoredFromBackup: true,
        backupDir: journal.backupDir,
        pruned: journal.pruned,
      },
    };
  }

  // Byte-level restore from backup
  await fsp.copyFile(backupLockPath, journal.lockPath);
  
  // Mark as undone instead of deleting journal (for history tracking)
  await writeLastFreeze({
    ...journal,
    undone: true,
  });
  
  logger.info("Freeze undone, lock.json restored from backup", {
    backupDir: journal.backupDir,
    packagesCount: journal.packagesCount,
  });
  
  return {
    reverted: journal.packagesCount,
    details: {
      restoredFromBackup: true,
      backupDir: journal.backupDir,
      pruned: journal.pruned,
    },
  };
}

/**
 * Unified undo: choose latest operation (freeze or apply) by mtime, ignoring already undone operations
 */
export async function undoLastOperation(
  rootDir: string,
  opts: { dryRun?: boolean } = {}
): Promise<{
  type: "freeze" | "apply";
  reverted: number;
  details?: any;
}> {
  const freezeJournalPath = `${rootDir}/.kb/devlink/last-freeze.json`;
  const applyJournalPath = `${rootDir}/.kb/devlink/last-apply.json`;
  
  // Check which journals exist and are NOT already undone
  let freezeStat = null;
  if (await exists(freezeJournalPath)) {
    const journal = await readLastFreeze(rootDir);
    if (journal && !journal.undone) {
      freezeStat = await fsp.stat(freezeJournalPath);
    }
  }
  
  let applyStat = null;
  if (await exists(applyJournalPath)) {
    const journal = await readLastApply(rootDir);
    if (journal && !journal.undone) {
      applyStat = await fsp.stat(applyJournalPath);
    }
  }
  
  // Determine most recent operation by mtime among non-undone operations - latest wins
  let operation: "freeze" | "apply" | null = null;
  
  if (freezeStat && applyStat) {
    operation = freezeStat.mtime > applyStat.mtime ? "freeze" : "apply";
  } else if (freezeStat) {
    operation = "freeze";
  } else if (applyStat) {
    operation = "apply";
  }
  
  if (!operation) {
    throw new Error(
      "No operations to undo. All recent operations have already been undone."
    );
  }
  
  logger.info(`Undoing last ${operation} operation`, { rootDir, dryRun: opts.dryRun });
  
  // Execute appropriate undo
  if (operation === "freeze") {
    const { reverted, details } = await undoLastFreeze(rootDir, opts);
    return {
      type: "freeze",
      reverted,
      details,
    };
  } else {
    await undoLastApply(rootDir, opts);
    const journal = await readLastApply(rootDir);
    return {
      type: "apply",
      reverted: journal?.actions.length ?? 0,
      details: { manifestsRestored: true },
    };
  }
}

