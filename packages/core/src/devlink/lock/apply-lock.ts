import { readJson, exists } from "../../utils/fs";
import { runCommand } from "../../utils/runCommand";
import { logger } from "../../utils/logger";
import type { LockFile } from "./freeze";

/**
 * Apply lock file: restore all dependencies to their locked versions
 */
export async function applyLock(
  rootDir: string,
  opts: { dryRun?: boolean } = {}
): Promise<void> {
  const lockPath = `${rootDir}/.kb/devlink/lock.json`;

  if (!(await exists(lockPath))) {
    throw new Error(`Lock file not found: ${lockPath}`);
  }

  const lockFile = await readJson<LockFile>(lockPath);
  logger.info("Applying lock file", {
    packages: Object.keys(lockFile.packages).length,
    dryRun: opts.dryRun
  });

  for (const [pkgName, entry] of Object.entries(lockFile.packages)) {
    const version = entry.version;

    if (opts.dryRun) {
      logger.info(`[dry-run] Would install ${pkgName}@${version}`);
      continue;
    }

    try {
      // Remove any yalc links first
      await runCommand(`yalc remove ${pkgName} || true`, {
        cwd: rootDir,
        allowFail: true
      });

      // Install from npm at locked version
      await runCommand(`pnpm i ${pkgName}@${version}`, {
        cwd: rootDir
      });

      logger.debug(`Installed ${pkgName}@${version}`);
    } catch (error) {
      logger.warn(`Failed to install ${pkgName}@${version}`, error);
      throw error;
    }
  }

  logger.info("Lock file applied successfully");
}

