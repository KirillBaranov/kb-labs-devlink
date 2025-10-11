import { loadState } from "../../state";
import { readJson, exists } from "../../utils/fs";
import { logger } from "../../utils/logger";
import type { PackageJson } from "../../types";
import { join } from "path";

export interface StatusEntry {
  consumer: string;
  dep: string;
  source: "yalc" | "npm" | "workspace" | "unknown";
}

export interface StatusSummary {
  packages: number;
  links: number;
  unknown: number;
  entries: StatusEntry[];
}

/**
 * Check if a package is linked via yalc by checking yalc.lock
 */
async function checkYalcLink(consumerDir: string, depName: string): Promise<boolean> {
  const yalcLockPath = join(consumerDir, "yalc.lock");
  if (!(await exists(yalcLockPath))) {
    return false;
  }

  try {
    const yalcLock = await readJson<any>(yalcLockPath);
    return !!yalcLock.packages?.[depName];
  } catch {
    return false;
  }
}

/**
 * Get current devlink status
 */
export async function getStatus(rootDir: string): Promise<StatusSummary> {
  logger.info("Getting devlink status", { rootDir });

  const state = await loadState(rootDir);

  if (!state) {
    logger.warn("No state found. Run scan first.");
    return {
      packages: 0,
      links: 0,
      unknown: 0,
      entries: [],
    };
  }

  const entries: StatusEntry[] = [];
  let linksCount = 0;
  let unknownCount = 0;

  // Get all local package names for filtering
  const localPackageNames = new Set(state.packages.map(p => p.name));

  // Check each package for dependencies
  for (const pkg of state.packages) {
    try {
      const pkgJsonPath = join(pkg.pathAbs, "package.json");
      if (!(await exists(pkgJsonPath))) {
        continue;
      }

      const pkgJson = await readJson<PackageJson>(pkgJsonPath);
      const allDeps = {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
      };

      // Check each dependency
      for (const [depName, depVersion] of Object.entries(allDeps)) {
        // Only track local packages (those in our workspace)
        if (!localPackageNames.has(depName)) {
          continue;
        }

        // Determine source
        let source: StatusEntry["source"] = "unknown";

        // Check if it's a yalc link
        const isYalc = await checkYalcLink(pkg.pathAbs, depName);
        if (isYalc) {
          source = "yalc";
          linksCount++;
        }
        // Check if it's a workspace link
        else if (typeof depVersion === "string" && depVersion.startsWith("workspace:")) {
          source = "workspace";
          linksCount++;
        }
        // Check if it's from npm (version string without workspace:)
        else if (typeof depVersion === "string" && !depVersion.startsWith("workspace:")) {
          source = "npm";
        }
        else {
          unknownCount++;
        }

        entries.push({
          consumer: pkg.name,
          dep: depName,
          source,
        });
      }
    } catch (error) {
      logger.warn(`Failed to check status for ${pkg.name}`, error);
    }
  }

  return {
    packages: state.packages.length,
    links: linksCount,
    unknown: unknownCount,
    entries,
  };
}

