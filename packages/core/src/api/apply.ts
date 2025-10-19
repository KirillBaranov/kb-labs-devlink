import { join } from "node:path";
import { applyPlan as applyPlanImpl } from "../devlink/apply";
import { logger } from "../utils/logger";
import { runPreflightChecks } from "../utils/preflight";
import { backupPackageJsons } from "../utils/backup";
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

  // Create backups before mutation (skip in dry-run)
  let backupDir: string | undefined;
  if (!opts.dryRun) {
    const affectedDirs = new Set<string>();

    // Collect all affected package directories (convert package names to paths)
    for (const action of plan.actions) {
      if (action.target && typeof action.target === "string") {
        const pkgRef = plan.index.packages[action.target];
        if (pkgRef && pkgRef.dir) {
          affectedDirs.add(pkgRef.dir);
        }
      }
    }

    const timestamp = new Date().toISOString().replace(/:/g, "-");
    backupDir = join(plan.rootDir, ".kb", "devlink", "backups", timestamp);
    
    const backupResults = await backupPackageJsons(
      plan.rootDir,
      Array.from(affectedDirs),
      { timestamp }
    );

    const failedBackups = backupResults.filter((r) => !r.ok);
    if (failedBackups.length > 0) {
      warnings.push(`Failed to create ${failedBackups.length} backup(s)`);
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

    return {
      ok: result.ok,
      executed: result.executed,
      skipped: result.skipped,
      errors: result.errors,
      diagnostics: plan.diagnostics,
      warnings,
      needsInstall: result.needsInstall,
      manifestPatches: result.manifestPatches,
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

