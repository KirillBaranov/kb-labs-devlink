import { logger } from "../../utils/logger";
import { applyPlan } from "../apply";
import { buildPlan } from "../plan";
import type { PackageIndex, PackageGraph, DevLinkMode, ApplyResult } from "../types";

export async function updateDeps(
  index: PackageIndex,
  graph: PackageGraph,
  opts: {
    selector: string;        // например "@kb-labs/devkit"
    version?: string;        // например "^0.5.0"
    mode?: DevLinkMode;
    dryRun?: boolean;
  }
): Promise<ApplyResult> {
  logger.info(`devlink: update "${opts.selector}" → ${opts.version ?? "(auto)"} (mode=${opts.mode ?? "npm"})`);

  const plan = await buildPlan(index, graph, { mode: opts.mode ?? "npm" });
  plan.actions = plan.actions.filter(a => a.dep === opts.selector);

  return applyPlan(plan, { dryRun: !!opts.dryRun });
}