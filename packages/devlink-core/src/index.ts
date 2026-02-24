// Discovery
export {
  discoverMonorepos,
  buildPackageMap,
  buildPackageMapFiltered,
  analyzePackageDeps,
  type MonorepoInfo,
} from './discovery/index.js';

// Npm
export { isPublishedOnNpm, filterPublishedPackages } from './npm/index.js';

// Plan
export {
  buildPlan,
  describeChange,
  groupByMonorepo,
} from './plan/index.js';

// Apply
export {
  applyPlan,
  checkGitDirty,
  type ApplyOptions,
  type ApplyResult,
} from './apply/index.js';

// State
export {
  loadState,
  saveState,
  freeze,
  loadLock,
  type LockFile,
} from './state/index.js';

// Backup
export {
  createBackup,
  listBackups,
  getLastBackup,
  restoreBackup,
} from './backup/index.js';
