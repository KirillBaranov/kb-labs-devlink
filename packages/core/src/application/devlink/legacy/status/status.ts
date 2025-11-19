import path from "node:path";
import { promises as fsp } from "node:fs";
import { readJson, exists } from '@devlink/shared/utils/fs';
import { logger } from '@devlink/shared/utils/logger';
import type { PackageJson } from "../../types";
import type { LockFile } from "../lock/freeze";
import type { LastApplyJournal } from "../journal/last-apply";
import { findYalcArtifacts, detectProtocolConflicts } from "../artifacts";
import { 
  createCommandRegistry, 
  generateDevlinkSuggestions, 
  generateQuickActions,
  MultiCLISuggestions,
  type CommandSuggestion 
} from "@kb-labs/shared-cli-ui";
import { getDevlinkCommandIds } from '../commands';

// ============================================================================
// Type System
// ============================================================================

export type Severity = "info" | "warn" | "error";

export type WarningCode =
  | "LOCK_MISMATCH"
  | "BACKUP_MISSING"
  | "STALE_LOCK"
  | "MIXED_MODES"
  | "CRITICAL_DUPLICATES"
  | "UNRESOLVED_PEERS"
  | "YALC_MISSING_STORE"
  | "INCONSISTENT_LINKS"
  | "WORKSPACE_DRIFT"
  | "PEER_CONFLICTS"
  | "STALE_PLAN"
  | "UNINSTALL_NEEDED"
  | "STALE_YALC_ARTIFACTS"
  | "PROTOCOL_CONFLICTS";

export type ModeSource = "plan" | "lock" | "inferred" | "unknown";

export type Impact = "safe" | "disruptive";

export interface StatusContext {
  rootDir: string;
  mode: "local" | "yalc" | "workspace" | "auto" | "remote" | "unknown";
  modeSource: ModeSource;
  lastOperation: "apply" | "freeze" | "none";
  lastOperationTs: string | null; // ISO
  lastOperationAgeMs: number | null;
  preflightNeeded: boolean;
  undo: {
    available: boolean;
    reason: string | null; // "MANIFEST_MISSING" | "BACKUP_FOLDER_MISSING" | "JOURNAL_STALE" | "NO_OPERATIONS"
    type: "apply" | "freeze" | null;
    backupTs: string | null;
  };
}

export interface LockStats {
  exists: boolean;
  schemaVersion?: number;
  consumers: number;
  deps: number;
  sources: Record<string, number>; // workspace, link, npm, github
  generatedAt: string | null;
  entries?: Array<{ consumer: string; dep: string; source: string }>;
}

export interface DiffEntry {
  consumer: string;
  name: string;
  section: "dependencies" | "devDependencies" | "peerDependencies";
  from?: string;
  to?: string;
  lock?: string;
  manifest?: string;
}

export interface ConsumerDiff {
  added: DiffEntry[];
  updated: DiffEntry[];
  removed: DiffEntry[];
  mismatched: DiffEntry[];
}

export interface ManifestDiff {
  summary: { added: number; updated: number; removed: number; mismatched: number };
  byConsumer: Record<string, ConsumerDiff>;
  samples: {
    added: DiffEntry[];
    updated: DiffEntry[];
    removed: DiffEntry[];
    mismatched: DiffEntry[];
  };
}

export interface HealthWarning {
  code: WarningCode;
  severity: Severity;
  message: string;
  evidence?: string;
  examples?: string[];
  suggestionId?: string;
}

export interface ActionSuggestion {
  id: string;
  command: string;
  args: string[];
  description: string;
  impact: 'safe' | 'disruptive';
}

export interface ArtifactInfo {
  name: string;
  path: string;
  size?: number;
  modified?: Date;
  description: string;
}

export interface StatusReportV2 {
  ok: boolean;
  context: StatusContext;
  lock: LockStats;
  diff: ManifestDiff;
  warnings: HealthWarning[];
  suggestions: ActionSuggestion[];
  artifacts: ArtifactInfo[];
  timings: {
    readFs: number;
    readLock: number;
    diff: number;
    warnings: number;
    total: number;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Discover generated artifacts in the workspace
 */
export async function discoverArtifacts(rootDir: string): Promise<ArtifactInfo[]> {
  const artifacts: ArtifactInfo[] = [];
  const devlinkDir = path.join(rootDir, '.kb', 'devlink');
  
  // Check if devlink directory exists
  if (!(await exists(devlinkDir))) {
    return artifacts;
  }

  // Common artifact patterns
  const artifactPatterns = [
    {
      name: 'Plan',
      pattern: 'last-plan.json',
      description: 'Last generated plan'
    },
    {
      name: 'Lock',
      pattern: 'lock.json', 
      description: 'Dependency lock file'
    },
    {
      name: 'State',
      pattern: 'state.json',
      description: 'Current state'
    },
    {
      name: 'Last Apply',
      pattern: 'last-apply.json',
      description: 'Last apply journal'
    },
    {
      name: 'Last Freeze',
      pattern: 'last-freeze.json',
      description: 'Last freeze journal'
    }
  ];

  for (const artifact of artifactPatterns) {
    const artifactPath = path.join(devlinkDir, artifact.pattern);
    if (await exists(artifactPath)) {
      try {
        const stats = await fsp.stat(artifactPath);
        artifacts.push({
          name: artifact.name,
          path: artifactPath,
          size: stats.size,
          modified: stats.mtime,
          description: artifact.description
        });
      } catch (error) {
        // Skip if can't read stats
      }
    }
  }

  // Check for backup directory
  const backupDir = path.join(devlinkDir, 'backup');
  if (await exists(backupDir)) {
    try {
      const backupFiles = await fsp.readdir(backupDir);
      if (backupFiles.length > 0) {
        artifacts.push({
          name: 'Backups',
          path: backupDir,
          description: `${backupFiles.length} backup files`
        });
      }
    } catch (error) {
      // Skip if can't read backup directory
    }
  }

  return artifacts;
}

/**
 * Format milliseconds as human-readable age (e.g., "15m ago", "2h ago", "3d ago")
 */
export function formatAge(ageMs: number): string {
  const seconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {return `${days}d ago`;}
  if (hours > 0) {return `${hours}h ago`;}
  if (minutes > 0) {return `${minutes}m ago`;}
  return `${seconds}s ago`;
}

/**
 * Normalize path relative to rootDir for display
 */
export function normalizeDisplayPath(absolutePath: string, rootDir: string): string {
  const rel = path.relative(rootDir, absolutePath);
  return rel.startsWith("..") ? absolutePath : rel;
}

/**
 * Limited concurrency Promise.all
 */
export async function pLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result);
      executing.splice(executing.indexOf(p), 1);
    });

    executing.push(p);

    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Parse ISO timestamp to Date or null
 */
function parseTimestamp(ts: string | undefined): Date | null {
  if (!ts) {return null;}
  try {
    return new Date(ts);
  } catch {
    return null;
  }
}

/**
 * Get file mtime
 */
async function getFileMtime(filePath: string): Promise<Date | null> {
  try {
    const stats = await fsp.stat(filePath);
    return stats.mtime;
  } catch {
    return null;
  }
}

// ============================================================================
// Data Collectors
// ============================================================================

interface LastOperationInfo {
  operation: "apply" | "freeze" | "none";
  ts: string | null;
  ageMs: number | null;
  journalPath: string | null;
}

/**
 * 1. Determine mode from plan/lock/inference
 */
export async function determineMode(rootDir: string): Promise<{
  mode: StatusContext["mode"];
  modeSource: ModeSource;
}> {
  // Try reading last-plan.json first
  const planPath = path.join(rootDir, ".kb", "devlink", "last-plan.json");
  if (await exists(planPath)) {
    try {
      const plan = await readJson<{ mode?: string }>(planPath);
      if (plan.mode) {
        return {
          mode: plan.mode as StatusContext["mode"],
          modeSource: "plan",
        };
      }
    } catch (err) {
      logger.debug("Failed to read last-plan.json for mode", { err });
    }
  }

  // Try inferring from lock.json
  const lockPath = path.join(rootDir, ".kb", "devlink", "lock.json");
  if (await exists(lockPath)) {
    try {
      const lock = await readJson<LockFile>(lockPath);
      
      // Count sources
      let workspaceCount = 0;
      let linkCount = 0;
      let npmCount = 0;
      let githubCount = 0;

  for (const consumer of Object.values(lock.consumers)) {
    for (const entry of Object.values(consumer.deps)) {
          if (entry.source === "workspace") {workspaceCount++;}
          else if (entry.source === "link") {linkCount++;}
          else if (entry.source === "npm") {npmCount++;}
          else if (entry.source === "github") {githubCount++;}
        }
      }

      const total = workspaceCount + linkCount + npmCount + githubCount;
      if (total === 0) {
        return { mode: "unknown", modeSource: "inferred" };
      }

      // Heuristics
      if (linkCount > 0) {
        return { mode: "local", modeSource: "lock" };
      }
      if (workspaceCount / total > 0.5) {
        return { mode: "workspace", modeSource: "lock" };
      }
      if (npmCount + githubCount === total) {
        return { mode: "remote", modeSource: "lock" };
      }

      return { mode: "unknown", modeSource: "inferred" };
    } catch (err) {
      logger.debug("Failed to infer mode from lock.json", { err });
    }
  }

  return { mode: "unknown", modeSource: "unknown" };
}

/**
 * 2. Read last operation (apply or freeze)
 */
export async function readLastOperation(rootDir: string): Promise<LastOperationInfo> {
  const applyPath = path.join(rootDir, ".kb", "devlink", "last-apply.json");
  const freezePath = path.join(rootDir, ".kb", "devlink", "last-freeze.json");

  const [applyExists, freezeExists] = await Promise.all([
    exists(applyPath),
    exists(freezePath),
  ]);

  if (!applyExists && !freezeExists) {
    return { operation: "none", ts: null, ageMs: null, journalPath: null };
  }

  // Read both journals
  const results = await Promise.all([
    applyExists ? readJson<LastApplyJournal>(applyPath).catch(() => null) : null,
    freezeExists
      ? readJson<{ operation: string; ts: string }>(freezePath).catch(() => null)
      : null,
    applyExists ? getFileMtime(applyPath) : null,
    freezeExists ? getFileMtime(freezePath) : null,
  ]);

  const [applyJournal, freezeJournal, applyMtime, freezeMtime] = results;

  // Determine most recent operation
  let lastOp: "apply" | "freeze" | "none" = "none";
  let lastTs: string | null = null;
  let lastPath: string | null = null;

  const applyDate = applyJournal?.ts ? parseTimestamp(applyJournal.ts) : applyMtime;
  const freezeDate = freezeJournal?.ts ? parseTimestamp(freezeJournal.ts) : freezeMtime;

  if (applyDate && freezeDate) {
    // Both exist, choose most recent
    if (applyDate >= freezeDate) {
      lastOp = "apply";
      lastTs = applyJournal?.ts || (applyDate ? applyDate.toISOString() : null);
      lastPath = applyPath;
    } else {
      lastOp = "freeze";
      lastTs = freezeJournal?.ts || (freezeDate ? freezeDate.toISOString() : null);
      lastPath = freezePath;
    }
  } else if (applyDate) {
    lastOp = "apply";
    lastTs = applyJournal?.ts || (applyDate ? applyDate.toISOString() : null);
    lastPath = applyPath;
  } else if (freezeDate) {
    lastOp = "freeze";
    lastTs = freezeJournal?.ts || (freezeDate ? freezeDate.toISOString() : null);
    lastPath = freezePath;
  }

  const ageMs = lastTs ? Date.now() - new Date(lastTs).getTime() : null;

  return { operation: lastOp, ts: lastTs, ageMs, journalPath: lastPath };
}

/**
 * 3. Check undo availability
 */
export async function checkUndoAvailability(
  rootDir: string,
  lastOp: LastOperationInfo
): Promise<{
  available: boolean;
  reason: string | null;
  type: "apply" | "freeze" | null;
  backupTs: string | null;
}> {
  if (lastOp.operation === "none") {
    return {
      available: false,
      reason: "NO_OPERATIONS",
      type: null,
      backupTs: null,
    };
  }

  if (lastOp.operation === "freeze") {
    const freezePath = path.join(rootDir, ".kb", "devlink", "last-freeze.json");
    try {
      const journal = await readJson<{ undone?: boolean; ts: string; backupDir?: string }>(
        freezePath
      );

      if (journal.undone) {
        return {
          available: false,
          reason: "JOURNAL_STALE",
          type: "freeze",
          backupTs: null,
        };
      }

      // Extract timestamp from journal
      const backupTs = journal.ts?.replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
      const backupDir = journal.backupDir || path.join(rootDir, ".kb", "devlink", "backups", backupTs);
      
      // Check for lock.json in new structure (type.freeze/) or old structure (root)
      const lockBackupNew = path.join(backupDir, "type.freeze", "lock.json");
      const lockBackupOld = path.join(backupDir, "lock.json");
      
      const hasLockBackup = (await exists(lockBackupNew)) || (await exists(lockBackupOld));

      if (!hasLockBackup) {
        return {
          available: false,
          reason: "BACKUP_FOLDER_MISSING",
          type: "freeze",
          backupTs,
        };
      }

      return {
        available: true,
        reason: null,
        type: "freeze",
        backupTs,
      };
    } catch {
      return {
        available: false,
        reason: "JOURNAL_STALE",
        type: "freeze",
        backupTs: null,
      };
    }
  }

  // Apply operation
  const applyPath = path.join(rootDir, ".kb", "devlink", "last-apply.json");
  try {
    const journal = await readJson<LastApplyJournal>(applyPath);

    if (journal.undone) {
      return {
        available: false,
        reason: "JOURNAL_STALE",
        type: "apply",
        backupTs: null,
      };
    }

    // Check backup directory exists
    if (!journal.backupDir) {
      return {
        available: false,
        reason: "BACKUP_FOLDER_MISSING",
        type: "apply",
        backupTs: null,
      };
    }

    if (!(await exists(journal.backupDir))) {
      return {
        available: false,
        reason: "BACKUP_FOLDER_MISSING",
        type: "apply",
        backupTs: path.basename(journal.backupDir),
      };
    }

    // Check at least some manifests exist in backup
    if (journal.manifestPatches && journal.manifestPatches.length > 0) {
      const firstPatch = journal.manifestPatches[0];
      if (firstPatch && firstPatch.manifestPath) {
        const backupManifest = path.join(journal.backupDir, firstPatch.manifestPath);
        if (!(await exists(backupManifest))) {
          return {
            available: false,
            reason: "MANIFEST_MISSING",
            type: "apply",
            backupTs: path.basename(journal.backupDir),
          };
        }
      }
    }

    return {
      available: true,
      reason: null,
      type: "apply",
      backupTs: path.basename(journal.backupDir),
    };
  } catch {
    return {
      available: false,
      reason: "JOURNAL_STALE",
      type: "apply",
      backupTs: null,
    };
  }
}

/**
 * 4. Compute manifest diff (lock vs current manifests)
 */
export async function computeManifestDiff(
  rootDir: string,
  lock: LockFile | null,
  options?: { consumer?: string }
): Promise<ManifestDiff> {
  const emptyDiff: ManifestDiff = {
    summary: { added: 0, updated: 0, removed: 0, mismatched: 0 },
    byConsumer: {},
    samples: { added: [], updated: [], removed: [], mismatched: [] },
  };

  if (!lock) {return emptyDiff;}

  const consumers = Object.keys(lock.consumers);
  if (consumers.length === 0) {return emptyDiff;}

  // Filter consumers if needed
  const filteredConsumers = options?.consumer
    ? consumers.filter((name) => name.includes(options.consumer!))
    : consumers;

  // Read manifests in parallel with limited concurrency
  const manifestCache = new Map<string, PackageJson | null>();

  const readTasks = filteredConsumers.map((consumerName) => async () => {
    const consumer = lock.consumers[consumerName];
    if (!consumer) {
      return { consumerName, manifest: null };
    }
    
    const manifestPath = path.resolve(rootDir, consumer.manifest);

    if (manifestCache.has(manifestPath)) {
      return { consumerName, manifest: manifestCache.get(manifestPath)! };
    }

    try {
      const manifest = await readJson<PackageJson>(manifestPath);
      manifestCache.set(manifestPath, manifest);
      return { consumerName, manifest };
    } catch {
      manifestCache.set(manifestPath, null);
      return { consumerName, manifest: null };
    }
  });

  const manifestResults = await pLimit(readTasks, 16);

  // Compute diff per consumer
  const byConsumer: Record<string, ConsumerDiff> = {};
  let totalAdded = 0;
  const totalUpdated = 0;
  let totalRemoved = 0;
  let totalMismatched = 0;

  const allAdded: DiffEntry[] = [];
  const allUpdated: DiffEntry[] = [];
  const allRemoved: DiffEntry[] = [];
  const allMismatched: DiffEntry[] = [];

  for (const { consumerName, manifest } of manifestResults) {
    if (!manifest) {continue;}

    const consumer = lock.consumers[consumerName];
    if (!consumer) {continue;}
    
    const lockDeps = consumer.deps;

    const consumerDiff: ConsumerDiff = {
      added: [],
      updated: [],
      removed: [],
      mismatched: [],
    };

    // Collect all manifest deps
    const manifestDeps = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
    };

    const manifestDepNames = new Set(Object.keys(manifestDeps));
    const lockDepNames = new Set(Object.keys(lockDeps));

    // Find added (in manifest, not in lock)
    for (const depName of manifestDepNames) {
      if (!lockDepNames.has(depName)) {
        const section = manifest.dependencies?.[depName]
          ? "dependencies"
          : manifest.devDependencies?.[depName]
          ? "devDependencies"
          : "peerDependencies";

        const entry: DiffEntry = {
          consumer: consumerName,
          name: depName,
          section,
          to: manifestDeps[depName] as string,
        };

        consumerDiff.added.push(entry);
        allAdded.push(entry);
        totalAdded++;
      }
    }

    // Find removed (in lock, not in manifest)
    for (const depName of lockDepNames) {
      if (!manifestDepNames.has(depName)) {
        const lockEntry = lockDeps[depName];
        if (!lockEntry) {continue;}
        
        const entry: DiffEntry = {
          consumer: consumerName,
          name: depName,
          section: "dependencies", // Default, we don't know from lock
          from: lockEntry.version,
        };

        consumerDiff.removed.push(entry);
        allRemoved.push(entry);
        totalRemoved++;
      }
    }

    // Find updated/mismatched (in both, but different versions)
    for (const depName of manifestDepNames) {
      if (lockDepNames.has(depName)) {
        const lockEntry = lockDeps[depName];
        if (!lockEntry) {continue;}
        
        const lockVersion = lockEntry.version;
        const manifestVersion = manifestDeps[depName] as string;

        const section = manifest.dependencies?.[depName]
          ? "dependencies"
          : manifest.devDependencies?.[depName]
          ? "devDependencies"
          : "peerDependencies";

        if (lockVersion !== manifestVersion) {
          const entry: DiffEntry = {
            consumer: consumerName,
            name: depName,
            section,
            lock: lockVersion,
            manifest: manifestVersion,
            from: lockVersion,
            to: manifestVersion,
          };

          consumerDiff.mismatched.push(entry);
          allMismatched.push(entry);
          totalMismatched++;
        }
      }
    }

    if (
      consumerDiff.added.length > 0 ||
      consumerDiff.updated.length > 0 ||
      consumerDiff.removed.length > 0 ||
      consumerDiff.mismatched.length > 0
    ) {
      byConsumer[consumerName] = consumerDiff;
    }
  }

  // Generate samples (max 5 per category)
  return {
    summary: {
      added: totalAdded,
      updated: totalUpdated,
      removed: totalRemoved,
      mismatched: totalMismatched,
    },
    byConsumer,
    samples: {
      added: allAdded.slice(0, 5),
      updated: allUpdated.slice(0, 5),
      removed: allRemoved.slice(0, 5),
      mismatched: allMismatched.slice(0, 5),
    },
  };
}

/**
 * 5. Compute health warnings
 */
export async function computeHealthWarnings(
  context: StatusContext,
  lock: LockStats,
  diff: ManifestDiff,
  rootDir: string
): Promise<HealthWarning[]> {
  const warnings: HealthWarning[] = [];

  // 1. LOCK_MISMATCH
  if (diff.summary.mismatched > 0) {
    const examples = diff.samples.mismatched
      .slice(0, 3)
      .map((e) => `${e.consumer}::${e.name}`);

    warnings.push({
      code: "LOCK_MISMATCH",
      severity: "warn",
      message: `Manifest differs from lock in ${diff.summary.mismatched} dependencies`,
      examples,
      suggestionId: "SYNC_LOCK",
    });
  }

  // 2. BACKUP_MISSING
  if (!context.undo.available && context.lastOperation !== "none") {
    warnings.push({
      code: "BACKUP_MISSING",
      severity: "warn",
      message: `Last ${context.lastOperation} operation has no valid backup`,
      evidence: context.undo.reason || undefined,
      suggestionId: "CREATE_BACKUP",
    });
  }

  // 3. STALE_LOCK
  if (lock.exists && lock.generatedAt) {
    const lockAge = Date.now() - new Date(lock.generatedAt).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    if (lockAge > sevenDays) {
      warnings.push({
        code: "STALE_LOCK",
        severity: "info",
        message: `Lock file is ${Math.floor(lockAge / sevenDays)} days old`,
        suggestionId: "REFRESH_LOCK",
      });
    }
  }

  // 4. MIXED_MODES
  if (lock.exists) {
    const sources = Object.keys(lock.sources).filter((k) => (lock.sources[k] || 0) > 0);
    if (sources.length > 2 && sources.includes("workspace") && sources.includes("link")) {
      warnings.push({
        code: "MIXED_MODES",
        severity: "info",
        message: "Mix of workspace, link, and npm dependencies detected",
        evidence: `Sources: ${sources.join(", ")}`,
      });
    }
  }

  // 5. CRITICAL_DUPLICATES (check for different versions of critical packages)
  const criticalPackages = ["react", "typescript", "vue", "eslint", "@types/react"];
  const versionMap = new Map<string, Set<string>>();

  for (const [consumerName, consumerDiff] of Object.entries(diff.byConsumer)) {
    // Collect versions from all entries
    const allEntries = [
      ...consumerDiff.added,
      ...consumerDiff.updated,
      ...consumerDiff.removed,
      ...consumerDiff.mismatched,
    ];

    for (const entry of allEntries) {
      if (criticalPackages.includes(entry.name)) {
        const version = entry.to || entry.manifest || entry.from || "";
        if (!versionMap.has(entry.name)) {
          versionMap.set(entry.name, new Set());
        }
        versionMap.get(entry.name)!.add(version);
      }
    }
  }

  for (const [pkg, versions] of versionMap) {
    if (versions.size > 1) {
      warnings.push({
        code: "CRITICAL_DUPLICATES",
        severity: "warn",
        message: `Package ${pkg} has ${versions.size} different versions`,
        examples: Array.from(versions).slice(0, 3),
      });
    }
  }

  // 6. Check for yalc artifacts in non-yalc mode
  if (context.mode !== "yalc") {
    const yalcArtifacts = await findYalcArtifacts(rootDir);
    if (yalcArtifacts.length > 0) {
      warnings.push({
        code: "STALE_YALC_ARTIFACTS",
        severity: "warn",
        message: `Found ${yalcArtifacts.length} yalc artifacts in non-yalc mode`,
        examples: yalcArtifacts.slice(0, 3),
        suggestionId: "CLEAN_YALC",
      });
    }
  }

  // 7. Check protocol conflicts
  const protocolConflicts = await detectProtocolConflicts(rootDir, lock);
  if (protocolConflicts.length > 0) {
    warnings.push({
      code: "PROTOCOL_CONFLICTS",
      severity: "error",
      message: `Found ${protocolConflicts.length} packages with conflicting protocols`,
      examples: protocolConflicts.slice(0, 3).map(c => 
        `${c.package}: ${c.protocols.join(' vs ')}`
      ),
      suggestionId: "FIX_PROTOCOLS",
    });
  }

  return warnings;
}

/**
 * Get available devlink commands from manifest
 */
function getDevlinkCommands(): string[] {
  return getDevlinkCommandIds();
}

/**
 * 6. Compute action suggestions using shared utilities
 */
export async function computeSuggestions(
  warnings: HealthWarning[],
  context: StatusContext,
  rootDir: string = process.cwd()
): Promise<ActionSuggestion[]> {
  // Use static devlink commands for suggestions
  // Dynamic discovery is too complex and causes errors during development
  const devlinkCommands = getDevlinkCommands();
  const registry = createCommandRegistry(devlinkCommands);
  const warningCodes = new Set(warnings.map((w) => w.code));
  const suggestions = generateDevlinkSuggestions(warningCodes, context, registry);
  
  return suggestions;
}


