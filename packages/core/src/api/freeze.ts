import { freezeToLock as freezeToLockImpl } from "../devlink/lock";
import { logger } from "../utils/logger";
import type { DevLinkPlan } from "../devlink/types";

export interface FreezeOptions {
  cwd?: string;
  pin?: "exact" | "caret";
}

export interface FreezeResult {
  ok: boolean;
  lockPath: string;
  diagnostics?: string[];
}

/**
 * Freeze plan to lock file
 * By default writes to .kb/devlink/lock.json with caret pinning
 */
export async function freeze(
  plan: DevLinkPlan,
  opts: FreezeOptions = {}
): Promise<FreezeResult> {
  const cwd = opts.cwd ?? plan.rootDir;
  const lockPath = `${cwd}/.kb/devlink/lock.json`;

  logger.info("Freezing plan to lock file", { lockPath, packages: plan.actions.length });

  try {
    // Update policy pin if specified
    if (opts.pin) {
      plan.policy.pin = opts.pin;
    }

    await freezeToLockImpl(plan, cwd);

    logger.info("Lock file created", { lockPath });

    return {
      ok: true,
      lockPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Freeze failed", { error: errorMessage });

    return {
      ok: false,
      lockPath,
      diagnostics: [errorMessage],
    };
  }
}

