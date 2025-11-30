/**
 * Infrastructure layer barrel. Exposes filesystem, process, discovery, CLI bridges,
 * analytics, and other external integrations consumed by the application layer.
 */

export * from './logging/logger';
export * from './process/run-command';
export * from './filesystem/fs';
export * from './filesystem/atomic';
export * from './time/timestamp';
export * from './vcs/git';
export * from './preflight/preflight';
export * from './backup/backup-manager';
export * from './watch/relink-strategies';
export * from './watch/process-manager';
export * from './watch/build-orchestrator';
export * from './watch/self-write-suppressor';
export * from './watch/loop-guard';
export * from './watch/signature';
export * from './state/state';
export * from './artifacts/artifacts';
export * from './discovery/discovery';
export * from './maintenance/clean';
export * from './analytics/events';
export * from './cli/types';
export { run as runApplyCommand } from './cli/apply';
export { run as runBackupsCommand } from './cli/backups';
export { run as runCleanCommand } from './cli/clean';
export { run as runFreezeCommand } from './cli/freeze';
export { run as runPlanCommand } from './cli/plan';
export { run as runStatusCommand } from './cli/status';
export { run as runSwitchCommand } from './cli/switch';
export { run as runUndoCommand } from './cli/undo';
export { run as runUpdateCommand } from './cli/update';
export { run as runWatchCommand } from './cli/watch';
