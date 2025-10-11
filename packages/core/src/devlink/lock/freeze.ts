import { writeJson } from "../../utils/fs";
import type { DevLinkPlan } from "../types";
import { logger } from "../../utils/logger";

export interface LockEntry {
  version: string;
  source: "npm" | "local";
}

export interface LockFile {
  generatedAt: string;
  mode: string;
  packages: Record<string, LockEntry>;
}

/**
 * Freeze current plan to lock file
 * Each dependency gets pinned version from policy or "latest" fallback
 */
export async function freezeToLock(
  plan: DevLinkPlan,
  cwd = plan.rootDir
): Promise<void> {
  const lockFile: LockFile = {
    generatedAt: new Date().toISOString(),
    mode: plan.mode,
    packages: {},
  };

  // Collect all dependencies from actions
  for (const action of plan.actions) {
    const dep = action.dep;

    // Get version from index if available
    const pkgRef = plan.index.packages[dep];
    const version = pkgRef?.version ?? "latest";

    // Pin version according to policy
    let pinnedVersion = version;
    if (plan.policy.pin === "exact" && version !== "latest") {
      pinnedVersion = version;
    } else if (plan.policy.pin === "caret" && version !== "latest") {
      pinnedVersion = `^${version}`;
    }

    // Always use npm for lock file (according to ADR-0012)
    lockFile.packages[dep] = {
      version: pinnedVersion,
      source: "npm",
    };
  }

  const lockPath = `${cwd}/.kb/devlink/lock.json`;
  await writeJson(lockPath, lockFile);

  logger.info("Lock file created", {
    path: lockPath,
    packages: Object.keys(lockFile.packages).length
  });
}

