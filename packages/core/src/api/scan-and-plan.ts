import { scanPackages } from "../devlink/scan";
import { buildPlan } from "../devlink/plan";
import { logger } from "../utils/logger";
import type { DevLinkMode, DevLinkPlan, DevLinkPolicy } from "../devlink/types";

export interface ScanAndPlanOptions {
  rootDir: string;
  roots?: string[];
  mode: DevLinkMode;
  policy?: Partial<DevLinkPolicy>;
  strict?: boolean;
}

export interface ScanAndPlanResult {
  ok: boolean;
  plan: DevLinkPlan | null;
  diagnostics: string[];
  timings: {
    discovery: number;
    graph: number;
    policy: number;
    plan: number;
    total: number;
  };
}

/**
 * Scan and plan: discovery → graph → policy → plan
 * Single entry point for CLI
 */
export async function scanAndPlan(
  opts: ScanAndPlanOptions
): Promise<ScanAndPlanResult> {
  const startTotal = Date.now();
  const diagnostics: string[] = [];
  const timings = {
    discovery: 0,
    graph: 0,
    policy: 0,
    plan: 0,
    total: 0,
  };

  try {
    // 1. Discovery + Graph
    logger.info("Starting scan and plan", {
      rootDir: opts.rootDir,
      roots: opts.roots && opts.roots.length ? opts.roots : undefined,
      mode: opts.mode
    });
    const t0 = Date.now();

    const { state, index, graph } = await scanPackages({
      rootDir: opts.rootDir,
      // multi-root support
      roots: opts.roots && opts.roots.length ? opts.roots : undefined,
    });

    const t1 = Date.now();
    timings.discovery = t1 - t0;
    timings.graph = 0; // included in scanPackages

    logger.debug("Scan completed", {
      packages: state.packages.length,
      deps: state.deps.length,
      rootsCount: opts.roots && opts.roots.length ? opts.roots.length : 1,
      time: timings.discovery,
    });

    // Check for cycles
    if (graph.cycles.length > 0) {
      diagnostics.push(
        `Dependency cycles detected: ${graph.cycles.length} cycle(s)`
      );
      logger.warn("Dependency cycles found", { cycles: graph.cycles.length });
    }

    // 2. Build plan with policy
    const t2 = Date.now();
    const plan = await buildPlan(index, graph, {
      mode: opts.mode,
      policy: opts.policy,
      strict: opts.strict,
    });
    const t3 = Date.now();
    timings.plan = t3 - t2;

    // Collect diagnostics from plan
    if (plan.diagnostics && plan.diagnostics.length > 0) {
      diagnostics.push(...plan.diagnostics);
    }

    timings.total = Date.now() - startTotal;

    logger.info("Plan created", {
      actions: plan.actions.length,
      diagnostics: diagnostics.length,
      time: timings.total,
    });

    return {
      ok: true,
      plan,
      diagnostics,
      timings,
    };
  } catch (error) {
    timings.total = Date.now() - startTotal;
    const errorMessage = error instanceof Error ? error.message : String(error);
    diagnostics.push(`Error: ${errorMessage}`);

    logger.error("Scan and plan failed", { error: errorMessage });

    return {
      ok: false,
      plan: null,
      diagnostics,
      timings,
    };
  }
}

