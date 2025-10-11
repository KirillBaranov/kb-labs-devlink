import { checkGitDirty } from "./git";
import { logger } from "./logger";

export interface PreflightOptions {
  rootDir: string;
  skipConfirmation?: boolean; // --yes flag
  dryRun?: boolean;
}

export interface PreflightResult {
  ok: boolean;
  warnings: string[];
  shouldProceed: boolean;
}

/**
 * Run preflight checks before mutating operations
 * - Check for uncommitted changes
 * - Warn if dirty (unless --yes or dryRun)
 */
export async function runPreflightChecks(
  opts: PreflightOptions
): Promise<PreflightResult> {
  const warnings: string[] = [];
  let shouldProceed = true;

  // Skip checks in dry-run mode
  if (opts.dryRun) {
    return { ok: true, warnings, shouldProceed: true };
  }

  // Check git status
  const gitStatus = await checkGitDirty(opts.rootDir);

  if (gitStatus.isDirty) {
    const fileList = gitStatus.files.slice(0, 5).join(", ");
    const more = gitStatus.files.length > 5 ? ` (and ${gitStatus.files.length - 5} more)` : "";

    warnings.push(
      `⚠️  Uncommitted changes detected in: ${fileList}${more}`
    );
    warnings.push(
      "   Devlink will modify package.json files. Consider committing your changes first."
    );

    if (!opts.skipConfirmation) {
      warnings.push(
        "   Use --yes to skip this warning and proceed anyway."
      );
      shouldProceed = false;
    } else {
      warnings.push(
        "   Proceeding anyway due to --yes flag."
      );
    }
  }

  // Log warnings
  if (warnings.length > 0) {
    for (const warning of warnings) {
      logger.warn(warning);
    }
  }

  return {
    ok: true,
    warnings,
    shouldProceed,
  };
}

