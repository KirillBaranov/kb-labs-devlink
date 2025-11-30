// Main barrel export for @kb-labs/devlink-core
// Maintains backward compatibility while exposing new structure

// CLI Commands
export {
  runApplyCommand,
  runBackupsCommand,
  runCleanCommand,
  runFreezeCommand,
  runPlanCommand,
  runStatusCommand,
  runSwitchCommand,
  runUndoCommand,
  runUpdateCommand,
  runWatchCommand,
} from './cli/commands';

// Core Operations (публичные типы)
export type {
  DevLinkPlan,
  DevLinkStatus,
  ScanResult,
  ApplyResult,
  WatchOptions,
  PlanOptions,
  ApplyOptions,
} from './core/operations';

// Models (публичные типы)
export type {
  DependencyGraph,
  DependencyNode,
  DevLinkPolicy,
} from './core/models';

// REST API
export * from './rest';

// Studio
export * from './studio';

// Types (публичные)
export type * from './types';
