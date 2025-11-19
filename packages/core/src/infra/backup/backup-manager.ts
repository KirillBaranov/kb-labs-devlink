/**
 * Backup management utilities
 */

import { promises as fsp } from "node:fs";
import path from "node:path";
import { exists, readJson } from "../filesystem/fs";
import { parseBackupTimestamp, formatTimestampAge, matchPartialTimestamp } from "../time/timestamp";
import { computeFileChecksum } from "../filesystem/atomic";
import { logger } from "../logging/logger";
import { runCommand } from "../process/run-command";

// ============================================================================
// Types
// ============================================================================

export interface BackupMetadata {
  schemaVersion: number;
  timestamp: string;
  type: "freeze" | "apply";
  rootDir: string;
  devlinkVersion: string;
  mode: string;
  policy: { pin: string };
  counts: {
    manifests: number;
    deps: number;
    consumers: number;
  };
  includes: {
    lock: boolean;
    manifests: boolean;
  };
  checksums: {
    "lock.json"?: string;
    manifests?: Record<string, string>; // POSIX paths → checksums
  };
  fileList: string[]; // All files in backup (POSIX paths)
  git?: {
    commit?: string;
    branch?: string;
    dirty: boolean;
  };
  plan?: {
    lastPlanPath?: string;
    planHash?: string;
  };
  platform: {
    os: string;
    arch: string;
  };
  node?: {
    pnpmVersion?: string;
    nodeVersion?: string;
  };
  sizes: {
    lockBytes?: number;
    manifestsBytes?: number;
    totalBytes: number;
  };
  isProtected: boolean; // Don't auto-delete
  tags?: string[]; // User-defined tags
  notes?: string;
}

export interface BackupInfo {
  timestamp: string;
  path: string;
  type: "freeze" | "apply";
  hasLock: boolean;
  hasManifests: boolean;
  consumersCount?: number;
  depsCount?: number;
  mode?: string;
  isProtected: boolean;
  age: number; // ms
  valid: boolean; // Quick check (backup.json exists)
  metadata?: BackupMetadata; // Full metadata if loaded
}

export interface CleanupResult {
  removed: BackupInfo[];
  kept: BackupInfo[];
  skippedProtected: BackupInfo[];
}

export interface RetentionPolicy {
  keepCount?: number; // Keep N most recent
  keepDays?: number; // Keep younger than N days
  minAge?: number; // Never delete younger than this (ms)
}

// ============================================================================
// Git Utilities
// ============================================================================

/**
 * Get current git info (commit, branch, dirty status)
 * Returns null if not in git repo or git unavailable
 */
export async function getGitInfo(): Promise<BackupMetadata["git"] | null> {
  try {
    // Get commit hash
    const commitResult = await runCommand("git rev-parse HEAD", {
      stdio: "pipe",
    });
    const commit = commitResult.stdout?.trim().slice(0, 7);

    // Get branch
    const branchResult = await runCommand("git rev-parse --abbrev-ref HEAD", {
      stdio: "pipe",
    });
    const branch = branchResult.stdout?.trim();

    // Check dirty status
    const statusResult = await runCommand("git status --porcelain", {
      stdio: "pipe",
    });
    const dirty = (statusResult.stdout?.trim() || "").length > 0;

    return { commit, branch, dirty };
  } catch {
    return null;
  }
}

/**
 * Check if specific files have uncommitted changes
 */
export async function checkFilesGitDirty(files: string[]): Promise<{
  dirty: boolean;
  modifiedFiles: string[];
}> {
  if (files.length === 0) {
    return { dirty: false, modifiedFiles: [] };
  }

  try {
    const filesArg = files.map((f) => `"${f}"`).join(" ");
    const result = await runCommand(`git status --porcelain ${filesArg}`, {
      stdio: "pipe",
    });

    const output = result.stdout?.trim() || "";
    if (!output) {
      return { dirty: false, modifiedFiles: [] };
    }

    const modifiedFiles = output
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter(Boolean);

    return { dirty: modifiedFiles.length > 0, modifiedFiles };
  } catch {
    // Git not available or not a git repo - return warning but don't fail
    logger.warn("Git check failed - not a git repo or git unavailable");
    return { dirty: false, modifiedFiles: [] };
  }
}

// ============================================================================
// Node/Runtime Info
// ============================================================================

/**
 * Get Node.js runtime info
 */
export async function getNodeInfo(): Promise<BackupMetadata["node"]> {
  try {
    const nodeVersion = process.version;

    // Try to get pnpm version
    let pnpmVersion: string | undefined;
    try {
      const result = await runCommand("pnpm --version", { stdio: "pipe" });
      pnpmVersion = result.stdout?.trim();
    } catch {
      // pnpm not available
    }

    return { nodeVersion, pnpmVersion };
  } catch {
    return { nodeVersion: process.version };
  }
}

// ============================================================================
// Backup Operations
// ============================================================================

/**
 * List all backups (lazy loading - only backup.json)
 * Performance target: <5ms for 100 backups
 */
export async function listBackups(
  rootDir: string,
  opts?: { type?: "freeze" | "apply"; validate?: boolean }
): Promise<BackupInfo[]> {
  const backupsDir = path.join(rootDir, ".kb", "devlink", "backups");

  if (!(await exists(backupsDir))) {
    return [];
  }

  try {
    const entries = await fsp.readdir(backupsDir, { withFileTypes: true });
    const backups: BackupInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) {continue;}
      if (entry.name.startsWith("_")) {continue;} // Skip special dirs like _quarantine

      const timestamp = entry.name;
      const backupPath = path.join(backupsDir, timestamp);
      const metadataPath = path.join(backupPath, "backup.json");

      // Quick check: backup.json exists
      const hasMetadata = await exists(metadataPath);

      if (!hasMetadata) {
        // Invalid backup - no metadata
        backups.push({
          timestamp,
          path: backupPath,
          type: "apply", // Unknown, default
          hasLock: false,
          hasManifests: false,
          isProtected: false,
          age: 0,
          valid: false,
        });
        continue;
      }

      // Read metadata
      try {
        const metadata = await readJson<BackupMetadata>(metadataPath);

        // Filter by type if requested
        if (opts?.type && metadata.type !== opts.type) {
          continue;
        }

        const parsed = parseBackupTimestamp(timestamp);
        const age = parsed.date ? Date.now() - parsed.date.getTime() : 0;

        const info: BackupInfo = {
          timestamp,
          path: backupPath,
          type: metadata.type,
          hasLock: metadata.includes.lock,
          hasManifests: metadata.includes.manifests,
          consumersCount: metadata.counts?.consumers,
          depsCount: metadata.counts?.deps,
          mode: metadata.mode,
          isProtected: metadata.isProtected || false,
          age,
          valid: true,
          metadata: metadata, // Always include metadata for detailed operations
        };

        backups.push(info);
      } catch (err) {
        logger.debug(`Failed to read backup metadata: ${timestamp}`, { err });
        backups.push({
          timestamp,
          path: backupPath,
          type: "apply",
          hasLock: false,
          hasManifests: false,
          isProtected: false,
          age: 0,
          valid: false,
        });
      }
    }

    // Sort by timestamp (newest first)
    backups.sort((a, b) => {
      const aDate = parseBackupTimestamp(a.timestamp).date;
      const bDate = parseBackupTimestamp(b.timestamp).date;
      if (!aDate || !bDate) {return 0;}
      return bDate.getTime() - aDate.getTime();
    });

    return backups;
  } catch (err) {
    logger.warn("Failed to list backups", { err });
    return [];
  }
}

/**
 * Get specific backup by timestamp (supports partial matching)
 */
export async function getBackup(
  rootDir: string,
  timestamp: string
): Promise<BackupInfo | null> {
  const backups = await listBackups(rootDir);
  const timestamps = backups.map((b) => b.timestamp);

  // Try exact match first
  let targetTimestamp = timestamp;

  // If not exact, try partial matching
  if (!timestamps.includes(timestamp)) {
    const result = matchPartialTimestamp(timestamp, timestamps);

    if (!result.match && result.candidates.length === 0) {
      return null; // No matches
    }

    if (result.candidates.length > 0) {
      // Multiple matches - ambiguous
      throw new Error(
        `AMBIGUOUS_TIMESTAMP: Multiple backups match '${timestamp}': ${result.candidates.join(", ")}`
      );
    }

    targetTimestamp = result.match!;
  }

  return backups.find((b) => b.timestamp === targetTimestamp) || null;
}

/**
 * Validate backup integrity (checksums)
 * Parallel validation with concurrency limit
 */
export async function validateBackup(
  backupPath: string,
  concurrency = 8
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    const metadataPath = path.join(backupPath, "backup.json");
    if (!(await exists(metadataPath))) {
      return { valid: false, errors: ["Missing backup.json"] };
    }

    const metadata = await readJson<BackupMetadata>(metadataPath);

    // Validate lock.json if included
    if (metadata.includes.lock && metadata.checksums["lock.json"]) {
      const lockPath = path.join(backupPath, "type.freeze", "lock.json");
      if (!(await exists(lockPath))) {
        const altLockPath = path.join(backupPath, "type.apply", "lock.json");
        if (!(await exists(altLockPath))) {
          errors.push("Missing lock.json (declared in metadata)");
        }
      } else {
        const actualChecksum = await computeFileChecksum(lockPath);
        if (actualChecksum !== metadata.checksums["lock.json"]) {
          errors.push(`lock.json checksum mismatch`);
        }
      }
    }

    // Validate manifests if included (with concurrency limit)
    if (metadata.includes.manifests && metadata.checksums.manifests) {
      const manifestPaths = Object.keys(metadata.checksums.manifests);
      const tasks = manifestPaths.map((posixPath) => async () => {
        const filePath = path.join(backupPath, "type.apply", "manifests", posixPath);
        if (!(await exists(filePath))) {
          errors.push(`Missing manifest: ${posixPath}`);
          return;
        }

        const actualChecksum = await computeFileChecksum(filePath);
        const expectedChecksum = metadata.checksums.manifests![posixPath];
        if (actualChecksum !== expectedChecksum) {
          errors.push(`Checksum mismatch: ${posixPath}`);
        }
      });

      // Execute with concurrency limit
      await executeConcurrent(tasks, concurrency);
    }

    return { valid: errors.length === 0, errors };
  } catch (err: any) {
    return { valid: false, errors: [`Validation error: ${err.message}`] };
  }
}

/**
 * Cleanup old backups with retention policy
 * Policy: keep if protected OR in keepCount OR younger than keepDays OR younger than minAge
 */
export async function cleanupOldBackups(
  rootDir: string,
  policy?: RetentionPolicy,
  dryRun = false
): Promise<CleanupResult> {
  const defaultPolicy: RetentionPolicy = {
    keepCount: 20,
    keepDays: 14,
    minAge: 3600000, // 1 hour
  };

  const finalPolicy = { ...defaultPolicy, ...policy };
  const backups = await listBackups(rootDir, { validate: false });

  const now = Date.now();
  const keepDaysMs = (finalPolicy.keepDays || 14) * 24 * 60 * 60 * 1000;

  const removed: BackupInfo[] = [];
  const kept: BackupInfo[] = [];
  const skippedProtected: BackupInfo[] = [];

  // Sort by age (newest first)
  const sortedBackups = [...backups].sort((a, b) => a.age - b.age);

  for (let i = 0; i < sortedBackups.length; i++) {
    const backup = sortedBackups[i];
    if (!backup) {continue;}

    // Check if should keep
    const backupIsProtected = backup.isProtected;
    const isInKeepCount = i < (finalPolicy.keepCount || 20);
    const isYoungerThanKeepDays = backup.age < keepDaysMs;
    const isYoungerThanMinAge = backup.age < (finalPolicy.minAge || 0);

    if (backupIsProtected) {
      skippedProtected.push(backup);
      continue;
    }

    if (isInKeepCount || isYoungerThanKeepDays || isYoungerThanMinAge) {
      kept.push(backup);
      continue;
    }

    // Mark for removal
    removed.push(backup);

    // Actually remove if not dry-run
    if (!dryRun) {
      try {
        await fsp.rm(backup.path, { recursive: true, force: true });
        logger.debug(`Removed backup: ${backup.timestamp}`);
      } catch (err) {
        logger.warn(`Failed to remove backup: ${backup.timestamp}`, { err });
      }
    }
  }

  return { removed, kept, skippedProtected };
}

/**
 * Mark backup as protected/unprotected
 */
export async function setBackupProtection(
  rootDir: string,
  timestamp: string,
  isProtected: boolean
): Promise<boolean> {
  const backup = await getBackup(rootDir, timestamp);
  if (!backup || !backup.valid) {return false;}

  const metadataPath = path.join(backup.path, "backup.json");
  
  try {
    // Read current metadata
    const metadata = await readJson<BackupMetadata>(metadataPath);
    const updated = { ...metadata, isProtected };
    
    // Write atomically
    await fsp.writeFile(metadataPath, JSON.stringify(updated, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Move corrupted backup to quarantine
 */
export async function quarantineBackup(
  backupPath: string
): Promise<boolean> {
  try {
    const backupsDir = path.dirname(backupPath);
    const quarantineDir = path.join(backupsDir, "_quarantine");
    await fsp.mkdir(quarantineDir, { recursive: true });

    const backupName = path.basename(backupPath);
    const quarantinePath = path.join(quarantineDir, backupName);

    await fsp.rename(backupPath, quarantinePath);
    logger.info(`Quarantined corrupted backup: ${backupName}`);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Execute tasks with concurrency limit
 */
async function executeConcurrent<T>(
  tasks: (() => Promise<T>)[],
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task().then((result) => {
      results.push(result);
      const idx = executing.indexOf(p);
      if (idx > -1) {executing.splice(idx, 1);}
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
 * Normalize path to POSIX for cross-platform storage
 */
export function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

/**
 * Convert POSIX path back to platform-specific
 */
export function fromPosixPath(posixPath: string): string {
  return posixPath.split("/").join(path.sep);
}

