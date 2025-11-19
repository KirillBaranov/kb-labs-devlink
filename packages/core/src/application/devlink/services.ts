import type {
  DevLinkServices,
  PackageScanner,
  PlanBuilder,
  PlanExecutor,
  WatcherFactory,
} from '../../domain/devlink/interfaces';
import { scanPackages } from './legacy/scan';
import { buildPlan } from './legacy/plan';
import { applyPlan } from './legacy/apply';
import { DevLinkWatcher } from './legacy/watch';
import type { DevLinkPlan, PackageGraph, PackageIndex, BuildPlanOptions, ApplyOptions, ApplyResult, ScanOptions } from './legacy/types';
import type { WatchOptions } from './legacy/watch';

const defaultScanner: PackageScanner = {
  async scan(options: ScanOptions) {
    return scanPackages(options);
  },
};

const defaultPlanBuilder: PlanBuilder = {
  build(index: PackageIndex, graph: PackageGraph, options: BuildPlanOptions): Promise<DevLinkPlan> {
    return buildPlan(index, graph, options);
  },
};

const defaultPlanExecutor: PlanExecutor = {
  apply(plan: DevLinkPlan, options?: ApplyOptions): Promise<ApplyResult> {
    return applyPlan(plan, options);
  },
};

const defaultWatcherFactory: WatcherFactory = {
  async create(options: WatchOptions): Promise<DevLinkWatcher> {
    return new DevLinkWatcher(options);
  },
};

export function createDefaultDevLinkServices(): DevLinkServices {
  return {
    scanner: defaultScanner,
    planner: defaultPlanBuilder,
    executor: defaultPlanExecutor,
    watcherFactory: defaultWatcherFactory,
  };
}

export const defaultDevLinkServices: DevLinkServices = createDefaultDevLinkServices();
