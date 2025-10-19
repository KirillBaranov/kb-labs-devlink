import { logger } from "../utils/logger";
import { runPreflightChecks } from "../utils/preflight";
import { walkPatterns } from "../utils/fs";
import { promises as fsp } from "fs";
import { join, relative } from "path";
import type { LockFile } from "../devlink/lock/freeze";

export interface ApplyLockFileOptions {
  rootDir: string;
  lockFile?: string;
  dryRun?: boolean;
  yes?: boolean; // Skip confirmation prompts
}

export interface ApplyLockFileResult {
  ok: boolean;
  executed: Array<{
    manifest: string; // relative path to package.json
    changes: Array<{ name: string; from: string; to: string; section: "dependencies" | "devDependencies" }>;
  }>;
  diagnostics: string[];
  warnings?: string[];
  preflight?: {
    cancelled: boolean;
    warnings: string[];
  };
  needsInstall: boolean; // true if there were changes (and !dryRun)
}

/**
 * Apply lock file: restore dependencies to locked versions (Manifest-first approach)
 * - Preflight (git-dirty, confirmation)
 * - Read lock file and collect all package.json files in workspace
 * - Update package.json files with locked versions (no pnpm calls)
 * - Return changes and needsInstall hint for CLI
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

  const executed: Array<{
    manifest: string;
    changes: Array<{ name: string; from: string; to: string; section: "dependencies" | "devDependencies" }>;
  }> = [];
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
    logger.warn("✋ Operation cancelled by preflight checks");
    return {
      ok: false,
      executed: [],
      diagnostics: ["✋ Operation cancelled by preflight checks"],
      warnings,
      preflight: {
        cancelled: true,
        warnings: preflight.warnings,
      },
      needsInstall: false,
    };
  }

  try {
    // Read lock file
    const lockContent = await fsp.readFile(lockPath, "utf8");
    const lockFile: LockFile = JSON.parse(lockContent);

    if (!lockFile.consumers || typeof lockFile.consumers !== 'object') {
      throw new Error("Invalid lock file: missing or invalid consumers section. Delete .kb/devlink/lock.json and re-freeze.");
    }

    // Process each consumer from lock file
    for (const [consumerName, consumer] of Object.entries(lockFile.consumers)) {
      const manifestPath = join(opts.rootDir, consumer.manifest);
      
      try {
        await fsp.access(manifestPath);
      } catch {
        diagnostics.push(`Manifest not found for consumer ${consumerName}: ${manifestPath}`);
        continue;
      }
      
      const changes = await processManifest(manifestPath, consumer.deps, opts.rootDir, opts.dryRun ?? false);
      if (changes.length > 0) {
        executed.push({
          manifest: relative(opts.rootDir, manifestPath),
          changes,
        });
      }
    }

    const needsInstall = !opts.dryRun && executed.length > 0;

    logger.info("Lock file applied", {
      lockPath,
      consumersProcessed: Object.keys(lockFile.consumers).length,
      manifestsChanged: executed.length,
      needsInstall,
    });

    return {
      ok: true,
      executed,
      diagnostics,
      warnings,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
      needsInstall,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error("Apply lock failed", { error: errMsg });

    diagnostics.push(errMsg);

    return {
      ok: false,
      executed: [],
      diagnostics,
      warnings,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
      needsInstall: false,
    };
  }
}

/**
 * Collect all package.json file paths in workspace
 */
async function collectManifestPaths(rootDir: string): Promise<string[]> {
  const paths: string[] = [];
  const patterns = walkPatterns(rootDir);

  for (const pattern of patterns) {
    try {
      const stats = await fsp.stat(pattern);
      if (stats.isDirectory()) {
        // For packages/* and apps/* directories, list subdirectories
        if (pattern !== rootDir) {
          const children = await fsp.readdir(pattern);
          for (const child of children) {
            const childPath = join(pattern, child);
            const childStats = await fsp.stat(childPath);
            if (childStats.isDirectory()) {
              const manifestPath = join(childPath, "package.json");
              try {
                await fsp.access(manifestPath);
                paths.push(manifestPath);
              } catch {
                // package.json doesn't exist, skip
              }
            }
          }
        } else {
          // For root directory, check if package.json exists
          const manifestPath = join(pattern, "package.json");
          try {
            await fsp.access(manifestPath);
            paths.push(manifestPath);
          } catch {
            // package.json doesn't exist, skip
          }
        }
      }
    } catch {
      // Directory doesn't exist or can't be accessed, skip
    }
  }

  return paths;
}

/**
 * Process a single manifest file and update dependencies according to lock
 */
async function processManifest(
  manifestPath: string,
  lockPackages: Record<string, { version: string; source: string }>,
  rootDir: string,
  dryRun: boolean
): Promise<Array<{ name: string; from: string; to: string; section: "dependencies" | "devDependencies" }>> {
  const changes: Array<{ name: string; from: string; to: string; section: "dependencies" | "devDependencies" }> = [];

  try {
    // Read current manifest
    const manifestContent = await fsp.readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestContent);

    if (!manifest) {
      return changes;
    }

    // Process dependencies and devDependencies
    const sections: Array<"dependencies" | "devDependencies"> = ["dependencies", "devDependencies"];

    for (const section of sections) {
      if (!manifest[section]) {
        continue;
      }

      for (const [depName, currentVersion] of Object.entries(manifest[section])) {
        if (typeof currentVersion !== "string") {
          continue;
        }

        const lockEntry = lockPackages[depName];
        if (!lockEntry) {
          continue;
        }

        const lockedVersion = lockEntry.version;

        // Only change if current version differs from locked version
        if (currentVersion !== lockedVersion) {
          changes.push({
            name: depName,
            from: currentVersion,
            to: lockedVersion,
            section,
          });

          // Update manifest if not dry run
          if (!dryRun) {
            manifest[section][depName] = lockedVersion;
          }
        }
      }
    }

    // Write updated manifest if not dry run and there were changes
    if (!dryRun && changes.length > 0) {
      // Note: Backup already created by preflight checks
      // Write updated manifest with preserved formatting
      await fsp.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    }

    return changes;
  } catch (error) {
    throw new Error(`Failed to process manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}