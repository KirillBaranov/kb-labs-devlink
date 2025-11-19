import { promises as fsp } from 'node:fs';
import { join, dirname } from 'node:path';
import path from 'node:path';

import { freezeToLockMerged, type FreezeDryRunResult } from '../legacy/lock/index';
import { writeLastFreeze } from '../../../domain/devlink/journal/last-apply';
import { exists, readJson } from '@devlink/infra/filesystem/fs';
import { logger } from '@devlink/infra/logging/logger';
import {
  createBackupTimestamp,
  AdvisoryLock,
  writeJsonAtomic,
  computeChecksum,
  getGitInfo,
  getNodeInfo,
  cleanupOldBackups,
  cleanupTempFiles,
  toPosixPath,
  type BackupMetadata,
} from '@devlink/infra/index';
import type { DevLinkPlan } from '../legacy/types/index';

export interface FreezeOptions {
  cwd?: string;
  pin?: 'exact' | 'caret';
  replace?: boolean;
  prune?: boolean;
  dryRun?: boolean;
}

export interface FreezeResult {
  ok: boolean;
  lockPath: string;
  diagnostics?: string[];
  meta?: {
    packagesCount?: number;
    backupDir?: string;
    replaced?: boolean;
    pruned?: string[];
  };
  diff?: {
    added: string[];
    updated: string[];
    removed: string[];
  };
  preflight?: {
    cancelled: boolean;
    warnings: string[];
  };
}

export async function freeze(
  plan: DevLinkPlan,
  opts: FreezeOptions = {},
): Promise<FreezeResult> {
  const cwd = opts.cwd ?? plan.rootDir;
  const lockPath = `${cwd}/.kb/devlink/lock.json`;
  const pin = opts.pin ?? plan.policy.pin ?? 'caret';
  const replace = opts.replace ?? false;
  const prune = opts.prune ?? false;
  const dryRun = opts.dryRun ?? false;
  const diagnostics: string[] = [];

  logger.info('Freezing plan to lock file', {
    lockPath,
    packages: plan.actions.length,
    pin,
    replace,
    prune,
    dryRun,
  });

  const devlinkDir = join(cwd, '.kb', 'devlink');
  await cleanupTempFiles(devlinkDir);
  const lock = new AdvisoryLock(join(devlinkDir, '.lock'));

  try {
    if (dryRun) {
      const result = await freezeToLockMerged(plan, cwd, {
        replace,
        prune,
        pin,
        dryRun: true,
        reason: 'manual-freeze-dry-run',
        initiatedBy: 'cli-user',
        command: `kb devlink freeze --pin ${pin}${dryRun ? ' --dry-run' : ''}${replace ? ' --replace' : ''}${prune ? ' --prune' : ''}`,
      });

      return {
        ok: true,
        lockPath,
        diff: result as FreezeDryRunResult,
        meta: { packagesCount: plan.actions.length },
        preflight: { cancelled: false, warnings: [] },
      };
    }

    await lock.acquire();

    const timestamp = createBackupTimestamp();
    const backupDir = join(cwd, '.kb', 'devlink', 'backups', timestamp);
    const typeFreezeDir = join(backupDir, 'type.freeze');

    await fsp.mkdir(backupDir, { recursive: true });

    let oldLockContent: string | null = null;
    let oldLockChecksum: string | null = null;

    if (await exists(lockPath)) {
      await fsp.mkdir(typeFreezeDir, { recursive: true });
      oldLockContent = await fsp.readFile(lockPath, 'utf-8');
      oldLockChecksum = computeChecksum(oldLockContent);
      await fsp.writeFile(join(typeFreezeDir, 'lock.json'), oldLockContent, 'utf-8');
      logger.debug('Old lock.json backed up', { backupDir });
    }

    await freezeToLockMerged(plan, cwd, {
      replace,
      prune,
      pin,
      dryRun: false,
      reason: 'manual-freeze',
      initiatedBy: 'cli-user',
      command: `kb devlink freeze --pin ${pin}${replace ? ' --replace' : ''}${prune ? ' --prune' : ''}`,
    });

    const lockContent = await fsp.readFile(lockPath, 'utf-8');
    const lockFile = JSON.parse(lockContent) as any;

    const totalDeps = lockFile.consumers
      ? Object.values(lockFile.consumers).reduce((sum: number, consumer: any) => sum + Object.keys(consumer.deps || {}).length, 0)
      : 0;

    const consumersCount = lockFile.consumers ? Object.keys(lockFile.consumers).length : 0;

    const [gitInfo, nodeInfo] = await Promise.all([
      getGitInfo(),
      getNodeInfo(),
    ]);

    const lastPlanPath = join(cwd, '.kb', 'devlink', 'last-plan.json');
    let planHash: string | undefined;
    if (await exists(lastPlanPath)) {
      const planContent = await fsp.readFile(lastPlanPath, 'utf-8');
      planHash = computeChecksum(planContent);
    }

    const lockStats = await fsp.stat(lockPath);
    const lockBytes = lockStats.size;

    const metadata: BackupMetadata = {
      schemaVersion: 1,
      timestamp,
      type: 'freeze',
      rootDir: cwd,
      devlinkVersion: '0.1.0',
      mode: plan.mode,
      policy: { pin },
      counts: {
        manifests: 0,
        deps: totalDeps,
        consumers: consumersCount,
      },
      includes: {
        lock: oldLockContent !== null,
        manifests: false,
      },
      checksums: oldLockChecksum ? { 'lock.json': oldLockChecksum } : {},
      fileList: oldLockContent ? ['type.freeze/lock.json'] : [],
      git: gitInfo || undefined,
      plan: planHash ? { lastPlanPath: '.kb/devlink/last-plan.json', planHash } : undefined,
      platform: {
        os: process.platform,
        arch: process.arch,
      },
      node: nodeInfo,
      sizes: {
        lockBytes,
        manifestsBytes: 0,
        totalBytes: lockBytes,
      },
      isProtected: false,
      tags: [],
    };

    await writeJsonAtomic(join(backupDir, 'backup.json'), metadata);

    await writeLastFreeze({
      operation: 'freeze',
      ts: timestamp,
      rootDir: cwd,
      lockPath,
      backupDir,
      packagesCount: totalDeps,
      replaced: replace,
      pruned: prune ? Object.keys(lockFile.consumers || {}) : undefined,
      pin,
    });

    logger.info('Freeze completed', {
      lockPath,
      packages: plan.actions.length,
      backupDir,
    });

    cleanupOldBackups(cwd).catch((err) => {
      logger.warn('Auto-cleanup failed', { err });
    });

    return {
      ok: true,
      lockPath,
      meta: {
        packagesCount: totalDeps,
        backupDir,
        replaced: replace,
        pruned: prune ? Object.keys(lockFile.consumers || {}) : undefined,
      },
      preflight: {
        cancelled: false,
        warnings: [],
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    diagnostics.push(errorMessage);
    logger.error('Freeze failed', { error: errorMessage });
    throw error;
  } finally {
    await lock.release().catch((err) => {
      logger.warn('Failed to release lock', { err });
    });
  }
}
