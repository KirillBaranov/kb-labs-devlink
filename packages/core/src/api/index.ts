// Facade API for @kb-labs/devlink-core
// Thin wrappers over existing modules with stable contracts

export {
  scanAndPlan,
  type ScanAndPlanOptions,
  type ScanAndPlanResult,
} from "./scan-and-plan";

export {
  apply,
  type ApplyPlanOptions,
  type ApplyPlanResult,
} from "./apply";

export {
  freeze,
  type FreezeOptions,
  type FreezeResult,
} from "./freeze";

export {
  applyLockFile,
  type ApplyLockFileOptions,
  type ApplyLockFileResult,
} from "./apply-lock";

export {
  undo,
  type UndoOptions,
  type UndoResult,
} from "./undo";

export {
  status,
  type StatusOptions,
  type StatusReport,
} from "./status";

// Re-export core types from devlink
export type {
  DevLinkMode,
  DevLinkPlan,
  DevLinkPolicy,
  LinkAction,
  LinkActionKind,
} from "../devlink/types";

// Re-export status types
export type {
  Severity,
  WarningCode,
  ModeSource,
  Impact,
  StatusContext,
  LockStats,
  DiffEntry,
  ConsumerDiff,
  ManifestDiff,
  HealthWarning,
  ActionSuggestion,
  StatusReportV2,
} from "../devlink/status";
