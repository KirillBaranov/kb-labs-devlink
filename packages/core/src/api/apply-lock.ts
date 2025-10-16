import { applyLock as applyLockImpl } from "../devlink/lock";
import { logger } from "../utils/logger";
import { runPreflightChecks } from "../utils/preflight";
import { backupFile } from "../utils/backup";

export interface ApplyLockFileOptions {
  rootDir: string;
  lockFile?: string;
  dryRun?: boolean;
  yes?: boolean; // Skip confirmation prompts
}

export interface ApplyLockFileResult {
  ok: boolean;
  executed: string[];
  diagnostics: string[];
  warnings?: string[];
  preflight?: {
    cancelled: boolean;
    warnings: string[];
  };
}

/**
 * Apply lock file: restore dependencies to locked versions
 * - Preflight (git-dirty, confirmation)
 * - Backup root package.json before mutation
 * - Delegate actual work to core applier
 */
export async function applyLockFile(
  opts: ApplyLockFileOptions
): Promise<ApplyLockFileResult> {
  const lockPath = opts.lockFile ?? `${opts.rootDir}/.kb/devlink/lock.json`;

  logger.info("Applying lock file", {
    lockPath,
    dryRun: opts.dryRun ?? false,
    yes: opts.yes ?? false,
  });

  const executed: string[] = [];
  const diagnostics: string[] = [];
  const warnings: string[] = [];

  // Preflight checks (skipped for dry-run)
  const preflight = await runPreflightChecks({
    rootDir: opts.rootDir,
    skipConfirmation: opts.yes,
    dryRun: opts.dryRun,
  });

  warnings.push(...preflight.warnings);

  if (!preflight.shouldProceed) {
    logger.warn("✋ Operation cancelled by preflight checks");
    return {
      ok: false,
      executed,
      diagnostics: ["✋ Operation cancelled by preflight checks"],
      warnings,
      preflight: {
        cancelled: true,
        warnings: preflight.warnings,
      },
    };
  }

  // Backup root package.json before mutation (skip in dry-run)
  if (!opts.dryRun) {
    const rootPackageJson = `${opts.rootDir}/package.json`;
    const backupResult = await backupFile(rootPackageJson, {
      rootDir: opts.rootDir,
    });

    if (!backupResult.ok) {
      const msg = `Failed to create backup: ${backupResult.error}`;
      warnings.push(msg);
      logger.warn(msg);
    }
  }

  try {
    // Delegate to core implementation; make sure we pass along the "yes" flag
    await applyLockImpl(opts.rootDir, {
      dryRun: opts.dryRun,
      yes: opts.yes,
      lockFile: lockPath,
    });

    logger.info("Lock file applied", { lockPath });

    return {
      ok: true,
      executed, // core impl logs and performs the actions; we keep the list empty for now
      diagnostics,
      warnings,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Apply lock failed", { error: errMsg });

    diagnostics.push(errMsg);

    return {
      ok: false,
      executed,
      diagnostics,
      warnings,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  }
}