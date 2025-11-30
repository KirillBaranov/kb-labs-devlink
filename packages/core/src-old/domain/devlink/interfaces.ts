import type {
  DevLinkMode,
  DevLinkPlan,
  DevLinkPolicy,
  LinkAction,
  LinkActionKind,
  DevlinkState,
} from '@devlink/application/devlink/legacy/types';
import type { WatchOptions } from '@devlink/application/devlink/legacy/watch';
import type { DevLinkWatcher } from '@devlink/application/devlink/legacy/watch';

/**
 * Performs discovery and returns the state required to build plans.
 */
export interface PackageScanner {
  scan(options: ScanOptions): Promise<ScannerResult>;
}

export interface ScannerResult {
  state: DevlinkState;
  index: PackageIndex;
  graph: PackageGraph;
}

/**
 * Builds a DevLink plan for a given workspace snapshot.
 */
export interface PlanBuilder {
  build(index: PackageIndex, graph: PackageGraph, options: BuildPlanOptions): Promise<DevLinkPlan>;
}

/**
 * Applies a plan to the workspace. The adapter is responsible for side effects
 * such as manifest updates and dependency installation.
 */
export interface PlanExecutor {
  apply(plan: DevLinkPlan, options?: ApplyOptions): Promise<ApplyResult>;
}

/**
 * Factory that produces configured watchers. Keeping the factory as a thin
 * abstraction helps us inject alternate implementations during tests or for
 * different environments.
 */
export interface WatcherFactory {
  create(options: WatchOptions): Promise<DevLinkWatcher>;
}

/**
 * Aggregates the core services expected by application-layer orchestrators.
 */
export interface DevLinkServices {
  scanner: PackageScanner;
  planner: PlanBuilder;
  executor: PlanExecutor;
  watcherFactory: WatcherFactory;
}
