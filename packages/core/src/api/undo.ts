import { undoLastOperation, readLastApply } from "../devlink/journal";
import { logger } from "../utils/logger";
import { runPreflightChecks } from "../utils/preflight";
import { backupPackageJsons } from "../utils/backup";

export interface UndoOptions {
  rootDir: string;
  dryRun?: boolean;
  yes?: boolean; // Skip confirmation prompts
}

export interface UndoResult {
  ok: boolean;
  reverted: number;
  diagnostics: string[];
  warnings?: string[];
  operationType?: "freeze" | "apply";
  details?: any;
  preflight?: {
    cancelled: boolean;
    warnings: string[];
  };
}

/**
 * Undo last operation (freeze or apply)
 * Includes preflight checks and backups
 */
export async function undo(opts: UndoOptions): Promise<UndoResult> {
  logger.info("Undoing last operation", {
    rootDir: opts.rootDir,
    dryRun: opts.dryRun ?? false,
  });

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
    logger.warn("Operation cancelled due to preflight checks");
    return {
      ok: false,
      reverted: 0,
      diagnostics: ["Operation cancelled by preflight checks"],
      warnings,
      preflight: {
        cancelled: true,
        warnings: preflight.warnings,
      },
    };
  }

  // Create backups before mutation (skip in dry-run) - only for apply operations
  if (!opts.dryRun) {
    const journal = await readLastApply(opts.rootDir);

    if (journal) {
      // Load state to get package paths
      const { loadState } = await import("../state");
      const state = await loadState(opts.rootDir);

      const affectedDirs = new Set<string>();

      // Collect all affected package directories from journal
      // Target can be either package name or directory path
      for (const action of journal.actions) {
        if (action.target && typeof action.target === "string") {
          // Check if target is already a directory path
          if (action.target.includes("/") || action.target.includes("\\")) {
            affectedDirs.add(action.target);
          } else if (state) {
            // It's a package name, look up the directory
            const pkg = state.packages.find((p) => p.name === action.target);
            if (pkg && pkg.pathAbs) {
              affectedDirs.add(pkg.pathAbs);
            }
          }
        }
      }

      if (affectedDirs.size > 0) {
        const backupResults = await backupPackageJsons(
          opts.rootDir,
          Array.from(affectedDirs)
        );

        const failedBackups = backupResults.filter((r) => !r.ok);
        if (failedBackups.length > 0) {
          warnings.push(`Failed to create ${failedBackups.length} backup(s)`);
        }
      }
    }
  }

  try {
    const { type, reverted, details } = await undoLastOperation(opts.rootDir, {
      dryRun: opts.dryRun,
    });

    logger.info(`Undo completed (${type})`, { 
      rootDir: opts.rootDir, 
      reverted,
      details,
    });

    return {
      ok: true,
      reverted,
      diagnostics,
      warnings,
      operationType: type,
      details,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Undo failed", { error: errorMessage });

    diagnostics.push(errorMessage);

    return {
      ok: false,
      reverted: 0,
      diagnostics,
      warnings,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  }
}
