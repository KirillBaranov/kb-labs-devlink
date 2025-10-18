import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { runCommand } from "../../utils/runCommand";
import { logger } from "../../utils/logger";
import { readLastApply, readLastFreeze, writeLastFreeze, type LastApplyJournal } from "./last-apply";
import { readJson, exists, writeJson } from "../../utils/fs";
import type { LockFile } from "../lock/freeze";

/**
 * Undo last apply by reversing actions in reverse order
 */
export async function undoLastApply(
  rootDir: string,
  opts: { dryRun?: boolean } = {}
): Promise<void> {
  const journal = await readLastApply(rootDir);

  if (!journal) {
    throw new Error("No last-apply journal found. Nothing to undo.");
  }

  logger.info("Undoing last apply", {
    actions: journal.actions.length,
    dryRun: opts.dryRun
  });

  // Try to load lock file for version information
  const lockPath = `${rootDir}/.kb/devlink/lock.json`;
  let lockFile: LockFile | null = null;
  if (await exists(lockPath)) {
    try {
      lockFile = await readJson<LockFile>(lockPath);
    } catch {
      // Lock file not available or corrupted, continue without it
    }
  }

  // Process actions in reverse order
  const actionsReversed = [...journal.actions].reverse();

  for (const action of actionsReversed) {
    const { target, dep, kind } = action;

    if (opts.dryRun) {
      logger.info(`[dry-run] Would undo ${kind}: ${dep} in ${target}`);
      continue;
    }

    try {
      switch (kind) {
        case "link-local":
          // Remove yalc link
          await runCommand(`yalc remove ${dep}`, {
            cwd: target,
            allowFail: true
          });

          // Restore from lock if available, otherwise install latest from npm
          let lockedVersion: string | undefined;
          if (lockFile?.consumers) {
            // Find consumer that matches target directory
            for (const consumer of Object.values(lockFile.consumers)) {
              if (consumer.deps[dep]) {
                lockedVersion = consumer.deps[dep].version;
                break;
              }
            }
          }
          
          if (lockedVersion) {
            await runCommand(`pnpm i ${dep}@${lockedVersion}`, { cwd: target });
            logger.debug(`Restored ${dep}@${lockedVersion} from lock`);
          } else {
            await runCommand(`pnpm i ${dep}`, { cwd: target });
            logger.debug(`Restored ${dep} from npm`);
          }
          break;

        case "use-workspace":
          // Re-install with workspace protocol (no-op if already workspace)
          await runCommand(`pnpm i ${dep}@workspace:*`, {
            cwd: target,
            allowFail: true
          });
          break;

        case "use-npm":
          // No-op: already on npm
          logger.debug(`Skipping undo for use-npm: ${dep} in ${target}`);
          break;

        case "unlink":
          // No-op: was already unlinked
          logger.debug(`Skipping undo for unlink: ${dep} in ${target}`);
          break;
      }
    } catch (error) {
      logger.warn(`Failed to undo action for ${dep} in ${target}`, error);
      // Continue with other actions
    }
  }

  logger.info("Undo completed");
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

  const backupLockPath = join(journal.backupDir, "lock.json");
  
  if (!(await exists(backupLockPath))) {
    throw new Error(`Cannot undo freeze: backup file not found at ${backupLockPath}`);
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
 * Unified undo: choose latest operation (freeze or apply) by mtime
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
  
  // Check which journals exist and get their timestamps (mtime)
  const freezeStat = await exists(freezeJournalPath)
    ? await fsp.stat(freezeJournalPath)
    : null;
  const applyStat = await exists(applyJournalPath)
    ? await fsp.stat(applyJournalPath)
    : null;
  
  // Determine most recent operation by mtime - latest wins
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
      "No operations to undo. Run 'kb devlink apply' or 'kb devlink freeze' first."
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

