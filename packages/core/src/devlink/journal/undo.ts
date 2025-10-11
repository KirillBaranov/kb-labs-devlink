import { runCommand } from "../../utils/runCommand";
import { logger } from "../../utils/logger";
import { readLastApply, type LastApplyJournal } from "./last-apply";
import { readJson, exists } from "../../utils/fs";
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
          if (lockFile?.packages[dep]) {
            const version = lockFile.packages[dep].version;
            await runCommand(`pnpm i ${dep}@${version}`, { cwd: target });
            logger.debug(`Restored ${dep}@${version} from lock`);
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

