import { join, dirname, relative } from "node:path";
import { promises as fsp } from "node:fs";
import { applyPlan as applyPlanImpl } from "../devlink/apply";
import { logger } from "../utils/logger";
import { runPreflightChecks } from "../utils/preflight";
import { exists, readJson } from "../utils/fs";
import { writeLastApplyJournal } from "../devlink/journal";
import {
  createBackupTimestamp,
  AdvisoryLock,
  writeJsonAtomic,
  computeChecksum,
  getGitInfo,
  getNodeInfo,
  cleanupOldBackups,
  cleanupTempFiles,
  toPosixPath,
  type BackupMetadata,
} from "../utils";
import type { DevLinkPlan, ApplyOptions as DevLinkApplyOptions, LinkAction, ManifestPatch } from "../devlink/types";

export interface ApplyPlanOptions {
  dryRun?: boolean;
  yes?: boolean; // Skip confirmation prompts
  logLevel?: "silent" | "info" | "debug";
  concurrency?: number;
}

export interface ApplyPlanResult {
  ok: boolean;
  executed: LinkAction[];
  skipped: LinkAction[];
  errors: Array<{ action: LinkAction; error: unknown }>;
  diagnostics?: string[];
  warnings?: string[];
  needsInstall?: boolean;
  manifestPatches?: ManifestPatch[];
  meta?: {
    backupTimestamp?: string;
    backupHasLock?: boolean;
    backupManifestsCount?: number;
  };
  preflight?: {
    cancelled: boolean;
    warnings: string[];
  };
}

/**
 * Apply plan: execute or dry-run
 * Delegates to devlink/apply with normalized result
 * Includes preflight checks and backups
 */
export async function apply(
  plan: DevLinkPlan,
  opts: ApplyPlanOptions = {}
): Promise<ApplyPlanResult> {
  logger.info("Applying plan", {
    actions: plan.actions.length,
    mode: plan.mode,
    dryRun: opts.dryRun ?? false,
    yes: opts.yes ?? false,
  });

  const startTime = Date.now();
  const warnings: string[] = [];

  // Preflight checks
  const preflight = await runPreflightChecks({
    rootDir: plan.rootDir,
    skipConfirmation: opts.yes,
    dryRun: opts.dryRun,
  });

  warnings.push(...preflight.warnings);

  if (!preflight.shouldProceed) {
    const cancelledMessage = "✋ Operation cancelled by preflight checks";
    logger.warn(cancelledMessage);
    return {
      ok: false,
      executed: [],
      skipped: [],
      errors: [],
      diagnostics: [cancelledMessage],
      warnings,
      preflight: {
        cancelled: true,
        warnings: preflight.warnings,
      },
    };
  }

  // Create structured backup before mutation
  let backupDir: string | undefined;
  let backupMetadata: BackupMetadata | undefined;
  let backupTimestamp: string | undefined;

  // Dry-run: calculate metadata without creating files
  if (opts.dryRun) {
    backupTimestamp = createBackupTimestamp();
    
    // Determine consumers list
    const lockPath = join(plan.rootDir, ".kb", "devlink", "lock.json");
    const hasLock = await exists(lockPath);
    let consumersList: string[] = [];
    
    if (hasLock) {
      try {
        const lockData = await readJson<any>(lockPath);
        consumersList = Object.keys(lockData.consumers || {});
      } catch {
        consumersList = Object.keys(plan.index.packages);
      }
    } else {
      consumersList = Object.keys(plan.index.packages);
    }
    
    // Return preview meta
    backupMetadata = {
      timestamp: backupTimestamp,
      type: "apply",
      includes: { lock: hasLock, manifests: true },
      counts: { manifests: consumersList.length, consumers: consumersList.length, deps: plan.actions.length },
    } as any;
    
    logger.debug("Dry-run: backup preview", { 
      timestamp: backupTimestamp,
      manifests: consumersList.length,
      lock: hasLock 
    });
  }

  // Real backup with advisory lock
  if (!opts.dryRun) {
    const timestamp = createBackupTimestamp();
    backupTimestamp = timestamp;
    backupDir = join(plan.rootDir, ".kb", "devlink", "backups", timestamp);
    const typeApplyDir = join(backupDir, "type.apply");
    
    // Advisory lock (prevents concurrent freeze/apply)
    const devlinkDir = join(plan.rootDir, ".kb", "devlink");
    await cleanupTempFiles(devlinkDir);
    const lock = new AdvisoryLock(join(devlinkDir, ".lock"));
    
    try {
      await lock.acquire();
      
      // Create directories
      await fsp.mkdir(typeApplyDir, { recursive: true });
      await fsp.mkdir(join(typeApplyDir, "manifests"), { recursive: true });
      
      // Backup lock.json if exists
      const lockPath = join(plan.rootDir, ".kb", "devlink", "lock.json");
      let lockChecksum: string | null = null;
      let lockBytes = 0;
      const hasLock = await exists(lockPath);
      let lockData: any = null;
      
      if (hasLock) {
        const lockBuffer = await fsp.readFile(lockPath);
        lockChecksum = computeChecksum(lockBuffer.toString("utf-8"));
        lockBytes = lockBuffer.length;
        
        // Atomic write: temp → rename
        const tmpLockPath = join(typeApplyDir, "lock.json.tmp");
        await fsp.writeFile(tmpLockPath, lockBuffer);
        await fsp.rename(tmpLockPath, join(typeApplyDir, "lock.json"));
        
        try {
          lockData = JSON.parse(lockBuffer.toString("utf-8"));
        } catch {
          lockData = null;
        }
      }
      
      // Determine consumers: prefer lock.consumers if available
      let consumersList: string[];
      if (lockData && lockData.consumers) {
        consumersList = Object.keys(lockData.consumers);
        logger.debug("Using consumers from lock.json", { count: consumersList.length });
      } else {
        consumersList = Object.keys(plan.index.packages);
        logger.debug("Using consumers from plan.index", { count: consumersList.length });
      }
      
      // Backup ALL consumer manifests (batched for performance)
      const manifestChecksums: Record<string, string> = {};
      const fileList: string[] = hasLock ? ["type.apply/lock.json"] : [];
      let manifestsBytes = 0;
      
      // Batch processing (32 files at a time)
      const BATCH_SIZE = 32;
      for (let i = 0; i < consumersList.length; i += BATCH_SIZE) {
        const batch = consumersList.slice(i, i + BATCH_SIZE);
        
        await Promise.all(batch.map(async (pkgName) => {
          const pkgRef = plan.index.packages[pkgName];
          if (!pkgRef || !pkgRef.dir) return;
          
          const pkgJsonPath = join(pkgRef.dir, "package.json");
          if (!(await exists(pkgJsonPath))) return;
          
          const buffer = await fsp.readFile(pkgJsonPath);
          const checksum = computeChecksum(buffer.toString("utf-8"));
          manifestsBytes += buffer.length;
          
          const relativePath = relative(plan.rootDir, pkgJsonPath);
          const posixPath = toPosixPath(relativePath);
          manifestChecksums[posixPath] = checksum;
          fileList.push(`type.apply/manifests/${posixPath}`);
          
          // Atomic write: temp → rename
          const backupPath = join(typeApplyDir, "manifests", posixPath);
          await fsp.mkdir(dirname(backupPath), { recursive: true });
          const tmpPath = `${backupPath}.tmp`;
          await fsp.writeFile(tmpPath, buffer);
          await fsp.rename(tmpPath, backupPath);
        }));
      }
      
      // Collect metadata (parallel)
      const [gitInfo, nodeInfo] = await Promise.all([
        getGitInfo(),
        getNodeInfo(),
      ]);
      
      // Get plan hash
      const lastPlanPath = join(plan.rootDir, ".kb", "devlink", "last-plan.json");
      let planHash: string | undefined;
      if (await exists(lastPlanPath)) {
        const planBuffer = await fsp.readFile(lastPlanPath);
        planHash = computeChecksum(planBuffer.toString("utf-8"));
      }
      
      // Create BackupMetadata
      backupMetadata = {
        schemaVersion: 1,
        timestamp,
        type: "apply",
        rootDir: plan.rootDir,
        devlinkVersion: "0.1.0",
        mode: plan.mode,
        policy: { pin: plan.policy.pin || "caret" },
        counts: {
          manifests: consumersList.length,
          deps: plan.actions.length,
          consumers: consumersList.length,
        },
        includes: {
          lock: hasLock,
          manifests: true,
        },
        checksums: {
          ...(lockChecksum && { "lock.json": lockChecksum }),
          manifests: manifestChecksums,
        },
        fileList,
        git: gitInfo || undefined,
        plan: planHash ? { lastPlanPath: ".kb/devlink/last-plan.json", planHash } : undefined,
        platform: {
          os: process.platform,
          arch: process.arch,
        },
        node: nodeInfo,
        sizes: {
          lockBytes: hasLock ? lockBytes : undefined,
          manifestsBytes,
          totalBytes: lockBytes + manifestsBytes,
        },
        isProtected: false,
        tags: [],
      };
      
      // Write backup.json atomically
      await writeJsonAtomic(join(backupDir, "backup.json"), backupMetadata);
      
      // Write last-apply journal (PENDING state, before mutations)
      await writeLastApplyJournal({
        rootDir: plan.rootDir,
        ts: timestamp,
        mode: plan.mode,
        actions: plan.actions,
        manifestPatches: [],
        backupDir,
        status: "pending",
        backupTimestamp: timestamp,
      } as any);
      
      logger.info("Created structured backup", { 
        timestamp, 
        manifests: consumersList.length, 
        lock: hasLock 
      });
      
    } finally {
      // Always release lock (even on errors)
      await lock.release();
    }
  }

  try {
    const result = await applyPlanImpl(plan, {
      ...opts,
      preflightCancelled: !preflight.shouldProceed,
      backupDir,
    } as DevLinkApplyOptions);

    const duration = Date.now() - startTime;
    logger.info("Apply completed", {
      ok: result.ok,
      executed: result.executed.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
      time: duration,
    });

    // Auto-cleanup old backups (async, don't wait)
    if (!opts.dryRun && result.ok) {
      cleanupOldBackups(plan.rootDir).then((cleanupResult) => {
        logger.info("Auto-cleanup completed", {
          removed: cleanupResult.removed.length,
          kept: cleanupResult.kept.length,
          protected: cleanupResult.skippedProtected.length,
        });
      }).catch((err) => {
        logger.warn("Auto-cleanup failed", { err });
      });
    }

    // Update last-apply journal to COMPLETED state
    if (!opts.dryRun && result.ok && backupTimestamp) {
      writeLastApplyJournal({
        rootDir: plan.rootDir,
        ts: backupTimestamp,
        mode: plan.mode,
        actions: result.executed,
        manifestPatches: result.manifestPatches,
        backupDir,
        status: "completed",
        backupTimestamp,
      } as any).catch((err) => {
        logger.warn("Failed to update journal to completed", { err });
      });
    }

    return {
      ok: result.ok,
      executed: result.executed,
      skipped: result.skipped,
      errors: result.errors,
      diagnostics: plan.diagnostics,
      warnings,
      needsInstall: result.needsInstall,
      manifestPatches: result.manifestPatches,
      meta: backupMetadata ? {
        backupTimestamp: backupMetadata.timestamp,
        backupHasLock: backupMetadata.includes.lock,
        backupManifestsCount: backupMetadata.counts.manifests,
      } : undefined,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Apply failed", { error: errorMessage });

    return {
      ok: false,
      executed: [],
      skipped: [],
      errors: [],
      diagnostics: [errorMessage],
      warnings,
      needsInstall: false,
      manifestPatches: [],
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  }
}

