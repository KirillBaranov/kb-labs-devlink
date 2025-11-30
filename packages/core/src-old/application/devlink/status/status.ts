import path from 'node:path';

import { exists, readJson } from '@devlink/infra/filesystem/fs';
import { logger } from '@devlink/infra/logging/logger';
import { loadState } from '@devlink/infra/state/state';
import {
  determineMode,
  readLastOperation,
  checkUndoAvailability,
  computeManifestDiff,
  computeHealthWarnings,
  computeSuggestions,
  discoverArtifacts,
  type StatusContext,
  type StatusReportV2,
  type LockStats,
} from '../legacy/status/index';
import type { LockFile, LockConsumer, LockEntry } from '../legacy/lock/index';
import type { DevlinkState, DepEdge } from '@devlink/shared/types';

function buildLockStats(lock: LockFile | null, existsOnDisk: boolean): LockStats {
  if (!lock) {
    return {
      exists: existsOnDisk,
      consumers: 0,
      deps: 0,
      sources: {
        workspace: 0,
        link: 0,
        npm: 0,
        github: 0,
      },
      generatedAt: null,
      entries: [],
    };
  }

  const sources: Record<string, number> = {
    workspace: 0,
    link: 0,
    npm: 0,
    github: 0,
  };
  const entries: Array<{ consumer: string; dep: string; source: string }> = [];

  let totalDeps = 0;
  for (const [consumerName, consumer] of Object.entries(lock.consumers || {})) {
    for (const [depName, entry] of Object.entries(consumer.deps || {})) {
      const sourceKey = entry.source || 'npm';
      sources[sourceKey] = (sources[sourceKey] || 0) + 1;
      totalDeps++;
      entries.push({ consumer: consumerName, dep: depName, source: entry.source });
    }
  }

  return {
    exists: existsOnDisk,
    schemaVersion: lock.schemaVersion,
    consumers: Object.keys(lock.consumers || {}).length,
    deps: totalDeps,
    sources,
    generatedAt: lock.generatedAt ?? null,
    entries,
  };
}

function createSyntheticLockFromState(state: DevlinkState, rootDir: string): LockFile {
  const consumers: Record<string, LockConsumer> = {};
  const edgesByConsumer = new Map<string, DepEdge[]>();
  const packageMap = new Map(state.packages.map((pkg) => [pkg.name, pkg]));

  for (const edge of state.deps) {
    if (!edgesByConsumer.has(edge.from)) {
      edgesByConsumer.set(edge.from, []);
    }
    edgesByConsumer.get(edge.from)!.push(edge);
  }

  for (const pkg of state.packages) {
    const manifestAbs = path.join(pkg.pathAbs, 'package.json');
    const manifestRel = path.relative(rootDir, manifestAbs) || 'package.json';
    const manifestNorm = manifestRel.split(path.sep).join('/');
    const deps: Record<string, LockEntry> = {};
    const pkgEdges = edgesByConsumer.get(pkg.name) ?? [];

    for (const edge of pkgEdges) {
      const provider = packageMap.get(edge.to);
      if (provider) {
        deps[edge.to] = {
          version: 'workspace:*',
          source: 'workspace',
        };
      } else {
        deps[edge.to] = {
          version: 'latest',
          source: 'npm',
        };
      }
    }

    consumers[pkg.name] = {
      manifest: manifestNorm,
      deps,
      extends: [],
      overrides: {},
    };
  }

  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: 'local',
    policy: { pin: 'caret' },
    consumers,
    meta: {
      format: 'per-consumer',
      lockVersion: 'synthetic',
      roots: [rootDir],
      reason: 'synthetic-from-state',
    },
  };
}

export type StatusReport = StatusReportV2;

export interface StatusOptions {
  rootDir: string;
  roots?: string[];
  consumer?: string;
  warningLevel?: 'all' | 'warn' | 'error' | 'none';
}

export async function status(opts: StatusOptions): Promise<StatusReport> {
  const startTime = Date.now();
  const rootDir = opts.rootDir;
  let readFsTime = 0;
  let readLockTime = 0;
  let diffTime = 0;
  const warningsTime = 0;

  logger.info('Getting status', { rootDir: opts.rootDir });

  try {
    const fsStart = Date.now();
    const [modeResult, lastOp] = await Promise.all([
      determineMode(opts.rootDir),
      readLastOperation(opts.rootDir),
    ]);
    readFsTime += Date.now() - fsStart;

    const lockStart = Date.now();
    const lockPath = path.join(opts.rootDir, '.kb', 'devlink', 'lock.json');
    const lockExistsOnDisk = await exists(lockPath);

    let lock: LockFile | null = null;
    let lockStats: LockStats;

    if (lockExistsOnDisk) {
      try {
        lock = await readJson<LockFile>(lockPath);
      } catch (err) {
        logger.warn('Failed to read lock file', { err });
      }
    }
    readLockTime += Date.now() - lockStart;

    if (!lock) {
      const state = await loadState(opts.rootDir);
      if (state) {
        lock = createSyntheticLockFromState(state, opts.rootDir);
        logger.debug('Synthesized lock from state for status', {
          packages: state.packages.length,
          deps: state.deps.length,
        });
        lockStats = buildLockStats(lock, false);
      } else {
        lockStats = buildLockStats(null, lockExistsOnDisk);
      }
    } else {
      lockStats = buildLockStats(lock, true);
    }

    const diffStart = Date.now();
    const [undoResult, diffResult] = await Promise.all([
      checkUndoAvailability(opts.rootDir, lastOp),
      computeManifestDiff(opts.rootDir, lock, { consumer: opts.consumer }),
    ]);
    diffTime += Date.now() - diffStart;

    const context: StatusContext = {
      rootDir: opts.rootDir,
      mode: modeResult.mode,
      modeSource: modeResult.modeSource,
      lastOperation: lastOp.operation,
      lastOperationTs: lastOp.ts,
      lastOperationAgeMs: lastOp.ageMs,
      preflightNeeded: false,
      undo: undoResult,
    };

    const artifacts = await discoverArtifacts(opts.rootDir);

    const warnings = await computeHealthWarnings(
      context,
      lockStats,
      diffResult,
      opts.rootDir,
    );

    const suggestions = await computeSuggestions(warnings, context, opts.rootDir);

    const totalTime = Date.now() - startTime;

    return {
      ok: warnings.every((w) => w.severity !== 'error'),
      context,
      lock: lockStats,
      diff: diffResult,
      warnings,
      suggestions,
      artifacts,
      timings: {
        total: totalTime,
        readFs: readFsTime,
        readLock: readLockTime,
        diff: diffTime,
        warnings: warningsTime,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to compute status', { error: errorMessage });
    throw error;
  }
}
