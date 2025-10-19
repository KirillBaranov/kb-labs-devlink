import { join } from "node:path";
import { promises as fsp } from "node:fs";
import { exists } from "../../utils/fs";
import { logger } from "../../utils/logger";
import type { PackageRef } from "../types";

/**
 * Detect build command for a provider package
 * Priority:
 * 1. package.json -> devlink.watch.build override
 * 2. tsconfig.json with references -> tsc -b
 * 3. package.json scripts.build -> pnpm/npm run build
 * 4. Fallback: pnpm -C <dir> build
 */
export async function detectBuildCommand(
  pkgRef: PackageRef
): Promise<string> {
  const pkgDir = pkgRef.dir;
  const pkgJsonPath = join(pkgDir, "package.json");

  // Priority 1: devlink.watch.build override
  if (await exists(pkgJsonPath)) {
    try {
      const content = await fsp.readFile(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      
      if (pkg.devlink?.watch?.build) {
        const override = pkg.devlink.watch.build;
        if (typeof override === "string") {
          logger.debug("Using devlink.watch.build override", { 
            pkg: pkgRef.name, 
            command: override 
          });
          return override;
        } else if (Array.isArray(override)) {
          // Join multiple commands with &&
          const command = override.join(" && ");
          logger.debug("Using devlink.watch.build override (array)", { 
            pkg: pkgRef.name, 
            command 
          });
          return command;
        }
      }

      // Priority 2: Check for tsconfig.json with references
      const tsconfigPath = join(pkgDir, "tsconfig.json");
      if (await exists(tsconfigPath)) {
        try {
          const tsconfigContent = await fsp.readFile(tsconfigPath, "utf-8");
          const tsconfig = JSON.parse(tsconfigContent);
          
          if (tsconfig.references && Array.isArray(tsconfig.references)) {
            logger.debug("Using tsc -b (project references detected)", { 
              pkg: pkgRef.name 
            });
            return "tsc -b";
          }
        } catch {
          // Failed to parse tsconfig, continue
        }
      }

      // Priority 3: Check for scripts.build
      if (pkg.scripts?.build) {
        // Use pnpm run instead of direct npm run for consistency
        logger.debug("Using pnpm run build (from scripts)", { 
          pkg: pkgRef.name 
        });
        return "pnpm run build";
      }
    } catch (err) {
      logger.debug("Failed to read package.json for build detection", { 
        pkg: pkgRef.name, 
        err 
      });
    }
  }

  // Priority 4: Fallback to pnpm -C <dir> build
  logger.debug("Using fallback build command", { pkg: pkgRef.name });
  return `pnpm -C ${pkgDir} build`;
}

/**
 * Detect watch paths for a provider
 * Returns array of glob patterns relative to package dir
 */
export function detectWatchPaths(pkgRef: PackageRef): string[] {
  const paths = [
    "package.json",
    "src/**/*",
    "tsconfig*.json",
    "dist/**/*", // tracked for loop prevention
  ];

  logger.debug("Watch paths detected", { pkg: pkgRef.name, paths });
  return paths;
}

/**
 * Check if path should be ignored for watching
 */
export function shouldIgnorePath(relativePath: string): boolean {
  const ignorePatterns = [
    "node_modules/",
    ".kb/devlink/backups/",
    ".test.",
    ".spec.",
    "__tests__/",
    "__mocks__/",
    ".git/",
    "coverage/",
  ];

  return ignorePatterns.some((pattern) => relativePath.includes(pattern));
}

