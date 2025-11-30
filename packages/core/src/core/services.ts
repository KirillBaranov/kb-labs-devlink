import type {
  DevLinkServices,
  PackageScanner,
  PlanBuilder,
  PlanExecutor,
  WatcherFactory,
} from '../models/interfaces';
import { scanPackages } from './operations/scan';
import { buildPlan } from './operations/plan';
import { applyPlan } from './operations/apply';
import { DevLinkWatcher } from './operations/watch';
import type { DevLinkPlan, PackageGraph, PackageIndex, BuildPlanOptions, ApplyOptions, ApplyResult, ScanOptions } from './operations/types';
import type { WatchOptions } from './operations/watch';

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
