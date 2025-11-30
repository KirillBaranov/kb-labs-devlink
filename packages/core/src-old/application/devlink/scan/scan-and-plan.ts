import { createDefaultDevLinkServices, defaultDevLinkServices } from '../services';
import type { DevLinkServices } from '../../../domain/devlink/interfaces';
import type { DevLinkMode, DevLinkPlan, DevLinkPolicy } from '../legacy/types/index';
import { logger } from '@devlink/infra/logging/logger';

export interface ScanAndPlanOptions {
  rootDir: string;
  roots?: string[];
  mode: DevLinkMode;
  policy?: Partial<DevLinkPolicy>;
  strict?: boolean;
  container?: boolean;
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

export async function scanAndPlan(
  opts: ScanAndPlanOptions,
  services: DevLinkServices = defaultDevLinkServices,
): Promise<ScanAndPlanResult> {
  const resolvedServices = services ?? createDefaultDevLinkServices();
  const startTotal = Date.now();
  const diagnostics: string[] = [];
  const timings = {
    discovery: 0,
    graph: 0,
    policy: 0,
    plan: 0,
    total: 0,
  };

  const explicitRoots = opts.roots && opts.roots.length > 0
    ? opts.roots
    : (opts.rootDir !== process.cwd() ? [opts.rootDir] : undefined);

  try {
    logger.info('Starting scan and plan', {
      rootDir: opts.rootDir,
      roots: opts.roots && opts.roots.length ? opts.roots : undefined,
      mode: opts.mode,
    });

    const t0 = Date.now();
    const { state, index, graph } = await resolvedServices.scanner.scan({
      rootDir: opts.rootDir,
      roots: explicitRoots,
      container: opts.container,
    });
    const t1 = Date.now();
    timings.discovery = t1 - t0;
    timings.graph = 0; // included in scanner implementation

    logger.debug('Scan completed', {
      packages: state.packages.length,
      deps: state.deps.length,
      rootsCount: opts.roots && opts.roots.length ? opts.roots.length : 1,
      time: timings.discovery,
    });

    if (graph.cycles.length > 0) {
      diagnostics.push(`Dependency cycles detected: ${graph.cycles.length} cycle(s)`);
      logger.warn('Dependency cycles found', { cycles: graph.cycles.length });
    }

    const t2 = Date.now();
    const plan = await resolvedServices.planner.build(index, graph, {
      mode: opts.mode,
      policy: opts.policy,
      strict: opts.strict,
    });
    const t3 = Date.now();
    timings.plan = t3 - t2;

    if (plan.diagnostics?.length) {
      diagnostics.push(...plan.diagnostics);
    }

    timings.total = Date.now() - startTotal;

    logger.info('Plan created', {
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

    logger.error('Scan and plan failed', { error: errorMessage });

    return {
      ok: false,
      plan: null,
      diagnostics,
      timings,
    };
  }
}
