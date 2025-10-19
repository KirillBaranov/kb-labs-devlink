import { promises as fsp } from "node:fs";
import { join } from "node:path";
import path from "node:path";
import { freezeToLockMerged, type FreezeDryRunResult } from "../devlink/lock";
import { writeLastFreeze } from "../devlink/journal";
import { exists, readJson } from "../utils/fs";
import { logger } from "../utils/logger";
import type { DevLinkPlan } from "../devlink/types";
import {
  createBackupTimestamp,
  AdvisoryLock,
  writeJsonAtomic,
  computeChecksum,
  computeFileChecksum,
  getGitInfo,
  getNodeInfo,
  cleanupOldBackups,
  cleanupTempFiles,
  toPosixPath,
  type BackupMetadata,
} from "../utils";

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

  // Cleanup temp files before starting
  const devlinkDir = join(cwd, ".kb", "devlink");
  await cleanupTempFiles(devlinkDir);

  // Advisory lock to prevent concurrent operations
  const lock = new AdvisoryLock(join(devlinkDir, ".lock"));

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

    // Acquire lock for write operation
    await lock.acquire();

    // Create ISO timestamp for backup
    const timestamp = createBackupTimestamp();
    const backupDir = join(cwd, ".kb", "devlink", "backups", timestamp);
    const typeFreezeDir = join(backupDir, "type.freeze");
    
    let oldLockContent: string | null = null;
    let oldLockChecksum: string | null = null;

    // Backup old lock.json if exists
    if (await exists(lockPath)) {
      await fsp.mkdir(typeFreezeDir, { recursive: true });
      
      oldLockContent = await fsp.readFile(lockPath, "utf-8");
      oldLockChecksum = computeChecksum(oldLockContent);
      
      // Write to backup
      await fsp.writeFile(join(typeFreezeDir, "lock.json"), oldLockContent, "utf-8");
      logger.debug("Old lock.json backed up", { backupDir });
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
    
    const consumersCount = lockFile.consumers ? Object.keys(lockFile.consumers).length : 0;

    // Collect metadata
    const [gitInfo, nodeInfo] = await Promise.all([
      getGitInfo(),
      getNodeInfo(),
    ]);

    // Get plan hash if exists
    const lastPlanPath = join(cwd, ".kb", "devlink", "last-plan.json");
    let planHash: string | undefined;
    if (await exists(lastPlanPath)) {
      const planContent = await fsp.readFile(lastPlanPath, "utf-8");
      planHash = computeChecksum(planContent);
    }

    // Get lock size
    const lockStats = await fsp.stat(lockPath);
    const lockBytes = lockStats.size;

    // Create backup.json metadata
    const metadata: BackupMetadata = {
      schemaVersion: 1,
      timestamp,
      type: "freeze",
      rootDir: cwd,
      devlinkVersion: "0.1.0",
      mode: plan.mode,
      policy: { pin },
      counts: {
        manifests: 0,
        deps: totalDeps,
        consumers: consumersCount,
      },
      includes: {
        lock: oldLockContent !== null,
        manifests: false,
      },
      checksums: oldLockChecksum ? { "lock.json": oldLockChecksum } : {},
      fileList: oldLockContent ? ["type.freeze/lock.json"] : [],
      git: gitInfo || undefined,
      plan: planHash ? { lastPlanPath: ".kb/devlink/last-plan.json", planHash } : undefined,
      platform: {
        os: process.platform,
        arch: process.arch,
      },
      node: nodeInfo,
      sizes: {
        lockBytes,
        manifestsBytes: 0,
        totalBytes: lockBytes,
      },
      isProtected: false,
      tags: [],
    };

    // Write backup.json atomically
    await writeJsonAtomic(join(backupDir, "backup.json"), metadata);

    // Write freeze journal for undo
    await writeLastFreeze({
      operation: "freeze",
      ts: timestamp,
      rootDir: cwd,
      lockPath,
      backupDir,
      packagesCount: totalDeps,
      replaced: replace,
      pin,
    });

    // Release lock
    await lock.release();

    // Auto-cleanup old backups (async, don't wait)
    cleanupOldBackups(cwd).then((result) => {
      logger.info("Auto-cleanup completed", {
        removed: result.removed.length,
        kept: result.kept.length,
        protected: result.skippedProtected.length,
      });
    }).catch((err) => {
      logger.warn("Auto-cleanup failed", { err });
    });

    logger.info("Freeze completed with backup and journal", { lockPath, timestamp });

    return {
      ok: true,
      lockPath,
      meta: {
        packagesCount: totalDeps,
        backupDir,
        replaced: replace,
      },
      preflight: { cancelled: false, warnings: [] },
    };
  } catch (error) {
    await lock.release();
    
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
