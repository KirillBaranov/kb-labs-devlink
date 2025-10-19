import path from "node:path";
import { readJson, exists } from "../utils/fs";
import { logger } from "../utils/logger";
import type { LockFile } from "../devlink/lock/freeze";
import {
  determineMode,
  readLastOperation,
  checkUndoAvailability,
  computeManifestDiff,
  computeHealthWarnings,
  computeSuggestions,
  type StatusReportV2,
  type LockStats,
} from "../devlink/status";

export type StatusReport = StatusReportV2;

export interface StatusOptions {
  rootDir: string;
  roots?: string[];
  consumer?: string;
  warningLevel?: "all" | "warn" | "error" | "none";
}

/**
 * Get comprehensive devlink status
 * Read-only operation, no auto-scan
 */
export async function status(opts: StatusOptions): Promise<StatusReport> {
  const startTime = Date.now();
  let readFsTime = 0;
  let readLockTime = 0;
  let diffTime = 0;
  let warningsTime = 0;

  logger.info("Getting status", { rootDir: opts.rootDir });

  try {
    // Phase 1: Read mode and last operation in parallel
    const fsStart = Date.now();
    const [modeResult, lastOp] = await Promise.all([
      determineMode(opts.rootDir),
      readLastOperation(opts.rootDir),
    ]);
    readFsTime += Date.now() - fsStart;

    // Phase 2: Read lock file
    const lockStart = Date.now();
    const lockPath = path.join(opts.rootDir, ".kb", "devlink", "lock.json");
    const lockExists = await exists(lockPath);

    let lock: LockFile | null = null;
    let lockStats: LockStats = {
      exists: false,
      consumers: 0,
      deps: 0,
      sources: {},
      generatedAt: null,
    };

    if (lockExists) {
      try {
        lock = await readJson<LockFile>(lockPath);
        
        // Compute lock stats
        const sources: Record<string, number> = {
          workspace: 0,
          link: 0,
          npm: 0,
          github: 0,
        };

        let totalDeps = 0;
        if (lock.consumers) {
          for (const consumer of Object.values(lock.consumers)) {
            if (consumer.deps) {
              for (const entry of Object.values(consumer.deps)) {
                sources[entry.source] = (sources[entry.source] || 0) + 1;
                totalDeps++;
              }
            }
          }
        }

        lockStats = {
          exists: true,
          schemaVersion: lock.schemaVersion,
          consumers: lock.consumers ? Object.keys(lock.consumers).length : 0,
          deps: totalDeps,
          sources,
          generatedAt: lock.generatedAt,
        };
      } catch (err) {
        logger.warn("Failed to read lock file", { err });
      }
    }
    readLockTime += Date.now() - lockStart;

    const diffStart = Date.now();
    const [undoResult, diffResult] = await Promise.all([
      checkUndoAvailability(opts.rootDir, lastOp),
      computeManifestDiff(opts.rootDir, lock, { consumer: opts.consumer }),
    ]);
    diffTime += Date.now() - diffStart;

    // Build context
    const context = {
      rootDir: opts.rootDir,
      mode: modeResult.mode,
      modeSource: modeResult.modeSource,
      lastOperation: lastOp.operation,
      lastOperationTs: lastOp.ts,
      lastOperationAgeMs: lastOp.ageMs,
      preflightNeeded: false, // TODO: determine based on context
      undo: undoResult,
    };

    // Phase 4: Compute warnings and suggestions
    const warningsStart = Date.now();
    const warnings = await computeHealthWarnings(context, lockStats, diffResult, opts.rootDir);
    
    // Filter warnings based on level
    let filteredWarnings = warnings;
    if (opts.warningLevel === "error") {
      filteredWarnings = warnings.filter((w) => w.severity === "error");
    } else if (opts.warningLevel === "warn") {
      filteredWarnings = warnings.filter((w) => w.severity === "error" || w.severity === "warn");
    } else if (opts.warningLevel === "none") {
      filteredWarnings = [];
    }

    const suggestions = computeSuggestions(filteredWarnings, context);
    warningsTime += Date.now() - warningsStart;

    const totalTime = Date.now() - startTime;

    const report: StatusReport = {
      ok: true,
      context,
      lock: lockStats,
      diff: diffResult,
      warnings: filteredWarnings,
      suggestions,
      timings: {
        readFs: readFsTime,
        readLock: readLockTime,
        diff: diffTime,
        warnings: warningsTime,
        total: totalTime,
      },
    };

    logger.info("Status complete", {
      mode: context.mode,
      lastOp: context.lastOperation,
      warnings: filteredWarnings.length,
      suggestions: suggestions.length,
      timeMs: totalTime,
    });

    return report;
  } catch (error: any) {
    logger.error("Status failed", { error: error.message });

    // Return error report
    return {
      ok: false,
      context: {
        rootDir: opts.rootDir,
        mode: "unknown",
        modeSource: "unknown",
        lastOperation: "none",
        lastOperationTs: null,
        lastOperationAgeMs: null,
        preflightNeeded: false,
        undo: {
          available: false,
          reason: "ERROR",
          type: null,
          backupTs: null,
        },
      },
      lock: {
        exists: false,
        consumers: 0,
        deps: 0,
        sources: {},
        generatedAt: null,
      },
      diff: {
        summary: { added: 0, updated: 0, removed: 0, mismatched: 0 },
        byConsumer: {},
        samples: { added: [], updated: [], removed: [], mismatched: [] },
      },
      warnings: [
        {
          code: "LOCK_MISMATCH",
          severity: "error",
          message: `Status check failed: ${error.message}`,
        },
      ],
      suggestions: [],
      timings: {
        readFs: readFsTime,
        readLock: readLockTime,
        diff: diffTime,
        warnings: warningsTime,
        total: Date.now() - startTime,
      },
    };
  }
}
