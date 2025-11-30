import { buildPlan } from '../plan';
import { applyPlan } from '../apply';
import type { ApplyResult, DevLinkMode, PackageGraph, PackageIndex } from '../types';

export async function switchMode(
  index: PackageIndex,
  graph: PackageGraph,
  mode: DevLinkMode,
): Promise<ApplyResult> {
  const plan = await buildPlan(index, graph, { mode });
  return applyPlan(plan, { dryRun: false });
}