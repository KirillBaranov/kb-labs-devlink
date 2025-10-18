import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { freezeToLockMerged, type FreezeDryRunResult } from "../devlink/lock";
import { writeLastFreeze } from "../devlink/journal";
import { exists, readJson } from "../utils/fs";
import { logger } from "../utils/logger";
import type { DevLinkPlan } from "../devlink/types";

export interface FreezeOptions {
  cwd?: string;
  pin?: "exact" | "caret";
  replace?: boolean;  // Default false - merge with existing
  prune?: boolean;    // Default false - keep old entries
  dryRun?: boolean;   // Default false - show diff without writing
}

export interface FreezeResult {
  ok: boolean;
  lockPath: string;
  diagnostics?: string[];
  meta?: {
    packagesCount?: number;
    backupDir?: string;
    replaced?: boolean;
    pruned?: string[];
  };
  diff?: {
    added: string[];
    updated: string[];
    removed: string[];
  };
  preflight?: {
    cancelled: boolean;
    warnings: string[];
  };
}

/**
 * Freeze plan to lock file
 * By default writes to .kb/devlink/lock.json with caret pinning and merge mode
 */
export async function freeze(
  plan: DevLinkPlan,
  opts: FreezeOptions = {}
): Promise<FreezeResult> {
  const cwd = opts.cwd ?? plan.rootDir;
  const lockPath = `${cwd}/.kb/devlink/lock.json`;
  const pin = opts.pin ?? plan.policy.pin ?? "caret";
  const replace = opts.replace ?? false;
  const prune = opts.prune ?? false;
  const dryRun = opts.dryRun ?? false;

  logger.info("Freezing plan to lock file", { 
    lockPath, 
    packages: plan.actions.length,
    pin,
    replace,
    prune,
    dryRun,
  });

  try {
    // Dry-run: calculate and return diff
    if (dryRun) {
      const result = await freezeToLockMerged(plan, cwd, {
        replace,
        prune,
        pin,
        dryRun: true,
        reason: "manual-freeze-dry-run",
        initiatedBy: "cli-user",
        command: `kb devlink freeze --pin ${pin}${dryRun ? ' --dry-run' : ''}${replace ? ' --replace' : ''}${prune ? ' --prune' : ''}`,
      });
      
      return {
        ok: true,
        lockPath,
        diff: result as FreezeDryRunResult,
        meta: { packagesCount: plan.actions.length },
        preflight: { cancelled: false, warnings: [] },
      };
    }

    // Create readable timestamped backup: 2025-10-18__22-44-53-678Z
    const timestamp = new Date().toISOString().replace("T", "__").replace(/[:.]/g, "-");
    const backupDir = join(cwd, ".kb", "devlink", "backups", timestamp);
    
    let prunedList: string[] = [];
    
    if (await exists(lockPath)) {
      // Create backup directory
      await fsp.mkdir(backupDir, { recursive: true });
      
      // Byte-level copy
      await fsp.copyFile(lockPath, join(backupDir, "lock.json"));
      logger.debug("Lock file backed up", { backupDir });
    }

    // Execute freeze with merge
    await freezeToLockMerged(plan, cwd, {
      replace,
      prune,
      pin,
      dryRun: false,
      reason: "manual-freeze",
      initiatedBy: "cli-user",
      command: `kb devlink freeze --pin ${pin}${replace ? ' --replace' : ''}${prune ? ' --prune' : ''}`,
    });
    
    // Read lock back to calculate stats
    const lockContent = await fsp.readFile(lockPath, "utf-8");
    const lockFile = JSON.parse(lockContent) as any;
    
    const totalDeps = lockFile.consumers 
      ? Object.values(lockFile.consumers).reduce((sum: number, c: any) => sum + Object.keys(c.deps || {}).length, 0)
      : 0;

    // Write freeze journal for undo
    await writeLastFreeze({
      operation: "freeze",
      ts: timestamp,
      rootDir: cwd,
      lockPath,
      backupDir,
      packagesCount: totalDeps,
      replaced: replace,
      pruned: prunedList.length > 0 ? prunedList : undefined,
      pin,
    });

    logger.info("Lock file created with backup and journal", { lockPath });

    return {
      ok: true,
      lockPath,
      meta: {
        packagesCount: totalDeps,
        backupDir,
        replaced: replace,
        pruned: prunedList.length > 0 ? prunedList : undefined,
      },
      preflight: { cancelled: false, warnings: [] },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Freeze failed", { error: errorMessage });

    return {
      ok: false,
      lockPath,
      diagnostics: [errorMessage],
      preflight: { cancelled: false, warnings: [] },
    };
  }
}
