// Export all commands
export { run as runApplyCommand } from './commands/apply';
export { run as runPlanCommand } from './commands/plan';
export { run as runStatusCommand } from './commands/status';
export { run as runSwitchCommand } from './commands/switch';
export { run as runUpdateCommand } from './commands/update';
export { run as runWatchCommand } from './commands/watch';
export { run as runFreezeCommand } from './commands/freeze';
export { run as runUndoCommand } from './commands/undo';
export { run as runCleanCommand } from './commands/clean';
export { run as runBackupsCommand } from './commands/backups';

// Manifest
export { manifest } from './manifest.v2';
export { manifest as manifestV2 } from './manifest.v2';
export type { ManifestV2 } from '@kb-labs/plugin-manifest';
