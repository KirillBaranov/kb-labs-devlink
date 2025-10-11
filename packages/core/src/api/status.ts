import { getStatus as getStatusImpl } from "../devlink/status";
import { logger } from "../utils/logger";
import type { StatusSummary } from "../devlink/status";

export type StatusReport = StatusSummary;

export interface StatusOptions {
  rootDir: string;
}

/**
 * Get current devlink status
 */
export async function status(opts: StatusOptions): Promise<StatusReport> {
  logger.info("Getting status", { rootDir: opts.rootDir });

  const result = await getStatusImpl(opts.rootDir);

  logger.info("Status retrieved", {
    packages: result.packages,
    links: result.links,
    unknown: result.unknown,
  });

  return result;
}

