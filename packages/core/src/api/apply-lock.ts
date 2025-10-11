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
}

/**
 * Apply lock file: restore dependencies to locked versions
 * Includes preflight checks and backups
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

  // Preflight checks
  const preflight = await runPreflightChecks({
    rootDir: opts.rootDir,
    skipConfirmation: opts.yes,
    dryRun: opts.dryRun,
  });

  warnings.push(...preflight.warnings);

  if (!preflight.shouldProceed) {
    logger.warn("Operation cancelled due to preflight checks. Use --yes to proceed anyway.");
    return {
      ok: false,
      executed,
      diagnostics: ["Operation cancelled by preflight checks"],
      warnings,
    };
  }

  // Backup root package.json before mutation (skip in dry-run)
  if (!opts.dryRun) {
    const rootPackageJson = `${opts.rootDir}/package.json`;
    const backupResult = await backupFile(rootPackageJson, {
      rootDir: opts.rootDir,
    });

    if (!backupResult.ok) {
      warnings.push(`Failed to create backup: ${backupResult.error}`);
    }
  }

  try {
    await applyLockImpl(opts.rootDir, {
      dryRun: opts.dryRun,
    });

    logger.info("Lock file applied", { lockPath });

    return {
      ok: true,
      executed,
      diagnostics,
      warnings,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Apply lock failed", { error: errorMessage });

    diagnostics.push(errorMessage);

    return {
      ok: false,
      executed,
      diagnostics,
      warnings,
    };
  }
}

