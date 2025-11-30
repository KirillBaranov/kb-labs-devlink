import { join, dirname, relative } from 'node:path';
import { promises as fsp } from 'node:fs';
import { logger } from '@devlink/infra/logging/logger';
import { runPreflightChecks } from '@devlink/infra/preflight/preflight';
import { exists, readJson } from '@devlink/infra/filesystem/fs';
import { detectStaleArtifacts } from '@devlink/infra/artifacts/artifacts';
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
import { writeLastApply, writeLastApplyJournal } from '../../../domain/devlink/journal/last-apply';
import { saveState } from '@devlink/infra/state/state';
import type { DevLinkPlan, ApplyOptions as DevLinkApplyOptions, LinkAction, ManifestPatch } from '../legacy/types/index';
import type { DevlinkState } from '@devlink/shared/types';
import type { DevLinkServices } from '../../../domain/devlink/interfaces';
import { defaultDevLinkServices } from '../services';

export interface ApplyPlanOptions {
  dryRun?: boolean;
  yes?: boolean;
  logLevel?: 'silent' | 'info' | 'debug';
  concurrency?: number;
}

export interface ApplyPlanResult {
  ok: boolean;
  executed: LinkAction[];
  skipped: LinkAction[];
  errors: Array<{ action: LinkAction; error: unknown }>;
  diagnostics?: string[];
  warnings?: string[];
  needsInstall?: boolean;
  manifestPatches?: ManifestPatch[];
  meta?: {
    backupTimestamp?: string;
    backupHasLock?: boolean;
    backupManifestsCount?: number;
  };
  preflight?: {
    cancelled: boolean;
    warnings: string[];
  };
}

export async function applyPlan(
  plan: DevLinkPlan,
  opts: ApplyPlanOptions = {},
  services: DevLinkServices = defaultDevLinkServices,
): Promise<ApplyPlanResult> {
  logger.info('Applying plan', {
    actions: plan.actions.length,
    mode: plan.mode,
    dryRun: opts.dryRun ?? false,
    yes: opts.yes ?? false,
  });

  const startTime = Date.now();
  const warnings: string[] = [];

  const preflight = await runPreflightChecks({
    rootDir: plan.rootDir,
    skipConfirmation: opts.yes,
    dryRun: opts.dryRun,
  });

  warnings.push(...preflight.warnings);

  const artifacts = await detectStaleArtifacts(plan.rootDir);
  if (artifacts.yalc.length > 0 || artifacts.conflicts.length > 0) {
    warnings.push(
      `Found stale artifacts from previous operations:\n` +
      `  - Yalc: ${artifacts.yalc.length} files\n` +
      `  - Conflicts: ${artifacts.conflicts.length} packages\n` +
      `\n` +
      `Recommend running: kb devlink clean`,
    );

    if (!opts.yes && !opts.dryRun) {
      const { createInterface } = await import('readline');
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question('Clean stale artifacts before apply? (y/N): ', resolve);
      });
      rl.close();

      if (answer.toLowerCase().startsWith('y')) {
        const { clean } = await import('@devlink/infra/maintenance/clean');
        await clean(plan.rootDir, { hard: false });
        logger.info('Cleaned stale artifacts');
      }
    }
  }

  if (!preflight.shouldProceed) {
    const cancelledMessage = '✋ Operation cancelled by preflight checks';
    logger.warn(cancelledMessage);
    return {
      ok: false,
      executed: [],
      skipped: [],
      errors: [],
      diagnostics: [cancelledMessage],
      warnings,
      preflight: {
        cancelled: true,
        warnings: preflight.warnings,
      },
    };
  }

  let backupDir: string | undefined;
  let backupMetadata: BackupMetadata | undefined;
  let backupTimestamp: string | undefined;

  if (opts.dryRun) {
    backupTimestamp = createBackupTimestamp();
    const lockPath = join(plan.rootDir, '.kb', 'devlink', 'lock.json');
    const hasLock = await exists(lockPath);
    let consumersList: string[] = [];

    if (hasLock) {
      try {
        const lockData = await readJson<any>(lockPath);
        consumersList = Object.keys(lockData.consumers || {});
      } catch {
        consumersList = Object.keys(plan.index.packages);
      }
    } else {
      consumersList = Object.keys(plan.index.packages);
    }

    backupMetadata = {
      timestamp: backupTimestamp,
      type: 'apply',
      includes: { lock: hasLock, manifests: true },
      counts: { manifests: consumersList.length, consumers: consumersList.length, deps: plan.actions.length },
    } as any;

    logger.debug('Dry-run: backup preview', {
      timestamp: backupTimestamp,
      manifests: consumersList.length,
      lock: hasLock,
    });
  }

  if (!opts.dryRun) {
    const timestamp = createBackupTimestamp();
    backupTimestamp = timestamp;
    backupDir = join(plan.rootDir, '.kb', 'devlink', 'backups', timestamp);
    const typeApplyDir = join(backupDir, 'type.apply');

    const devlinkDir = join(plan.rootDir, '.kb', 'devlink');
    await cleanupTempFiles(devlinkDir);
    const lock = new AdvisoryLock(join(devlinkDir, '.lock'));

    try {
      await lock.acquire();

      await fsp.mkdir(typeApplyDir, { recursive: true });
      await fsp.mkdir(join(typeApplyDir, 'manifests'), { recursive: true });

      const lockPath = join(plan.rootDir, '.kb', 'devlink', 'lock.json');
      let lockChecksum: string | null = null;
      let lockBytes = 0;
      const hasLock = await exists(lockPath);
      let lockData: any = null;

      if (hasLock) {
        const lockBuffer = await fsp.readFile(lockPath);
        lockChecksum = computeChecksum(lockBuffer.toString('utf-8'));
        lockBytes = lockBuffer.length;

        const tmpLockPath = join(typeApplyDir, 'lock.json.tmp');
        await fsp.writeFile(tmpLockPath, lockBuffer);
        await fsp.rename(tmpLockPath, join(typeApplyDir, 'lock.json'));

        try {
          lockData = JSON.parse(lockBuffer.toString('utf-8'));
        } catch {
          lockData = null;
        }
      }

      let consumersList: string[];
      if (lockData && lockData.consumers) {
        consumersList = Object.keys(lockData.consumers);
        logger.debug('Using consumers from lock.json', { count: consumersList.length });
      } else {
        consumersList = Object.keys(plan.index.packages);
        logger.debug('Using consumers from plan.index', { count: consumersList.length });
      }

      const manifestChecksums: Record<string, string> = {};
      const fileList: string[] = hasLock ? ['type.apply/lock.json'] : [];
      let manifestsBytes = 0;

      const BATCH_SIZE = 32;
      for (let i = 0; i < consumersList.length; i += BATCH_SIZE) {
        const batch = consumersList.slice(i, i + BATCH_SIZE);

        await Promise.all(batch.map(async (pkgName) => {
          const pkgRef = plan.index.packages[pkgName];
          if (!pkgRef || !pkgRef.dir) { return; }

          const pkgJsonPath = join(pkgRef.dir, 'package.json');
          if (!(await exists(pkgJsonPath))) { return; }

          const buffer = await fsp.readFile(pkgJsonPath);
          const checksum = computeChecksum(buffer.toString('utf-8'));
          manifestsBytes += buffer.length;

          const relativePath = relative(plan.rootDir, pkgJsonPath);
          const posixPath = toPosixPath(relativePath);
          manifestChecksums[posixPath] = checksum;
          fileList.push(`type.apply/manifests/${posixPath}`);

          const backupPath = join(typeApplyDir, 'manifests', posixPath);
          await fsp.mkdir(dirname(backupPath), { recursive: true });
          const tmpPath = `${backupPath}.tmp`;
          await fsp.writeFile(tmpPath, buffer);
          await fsp.rename(tmpPath, backupPath);
        }));
      }

      const [gitInfo, nodeInfo] = await Promise.all([
        getGitInfo(),
        getNodeInfo(),
      ]);

      const lastPlanPath = join(plan.rootDir, '.kb', 'devlink', 'last-plan.json');
      let planHash: string | undefined;
      if (await exists(lastPlanPath)) {
        const planBuffer = await fsp.readFile(lastPlanPath);
        planHash = computeChecksum(planBuffer.toString('utf-8'));
      }

      backupMetadata = {
        schemaVersion: 1,
        timestamp,
        type: 'apply',
        rootDir: plan.rootDir,
        devlinkVersion: '0.1.0',
        mode: plan.mode,
        policy: { pin: plan.policy.pin || 'caret' },
        counts: {
          manifests: consumersList.length,
          deps: plan.actions.length,
          consumers: consumersList.length,
        },
        includes: {
          lock: hasLock,
          manifests: true,
        },
        checksums: {
          ...(lockChecksum && { 'lock.json': lockChecksum }),
          manifests: manifestChecksums,
        },
        fileList,
        git: gitInfo || undefined,
        plan: planHash ? { lastPlanPath: '.kb/devlink/last-plan.json', planHash } : undefined,
        platform: {
          os: process.platform,
          arch: process.arch,
        },
        node: nodeInfo,
        sizes: {
          lockBytes: hasLock ? lockBytes : undefined,
          manifestsBytes,
          totalBytes: lockBytes + manifestsBytes,
        },
        isProtected: false,
        tags: [],
      };

      await writeJsonAtomic(join(backupDir, 'backup.json'), backupMetadata);

      await writeLastApplyJournal({
        rootDir: plan.rootDir,
        ts: timestamp,
        mode: plan.mode,
        actions: plan.actions,
        manifestPatches: [],
        backupDir,
        status: 'pending',
        backupTimestamp: timestamp,
      });

      logger.info('Created structured backup', {
        timestamp,
        manifests: consumersList.length,
        lock: hasLock,
      });
    } finally {
      await lock.release();
    }
  }

  try {
    const result = await services.executor.apply(plan, {
      ...opts,
      preflightCancelled: !preflight.shouldProceed,
      backupDir,
    } as DevLinkApplyOptions);

    const duration = Date.now() - startTime;
    logger.info('Apply completed', {
      ok: result.ok,
      executed: result.executed.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
      time: duration,
    });

    if (!opts.dryRun && result.ok) {
      cleanupOldBackups(plan.rootDir).then((cleanupResult) => {
        logger.info('Auto-cleanup completed', cleanupResult);
      }).catch((err) => {
        logger.warn('Auto-cleanup failed', { err });
      });
    }

    if (!opts.dryRun && result.ok && backupTimestamp) {
      writeLastApplyJournal({
        rootDir: plan.rootDir,
        ts: backupTimestamp,
        mode: plan.mode,
        actions: result.executed,
        manifestPatches: result.manifestPatches,
        backupDir,
        status: 'completed',
        backupTimestamp,
      }).catch((err) => {
        logger.warn('Failed to update journal to completed', { err });
      });
    }

    if (!opts.dryRun && result.ok) {
      const scanned = await services.scanner.scan({ rootDir: plan.rootDir, roots: [plan.rootDir] });
      const nextState: DevlinkState = {
        ...scanned.state,
        devlinkVersion: '0.1.0',
        generatedAt: new Date().toISOString(),
      };
      await saveState(nextState, plan.rootDir);
      await writeLastApply(plan, result.executed, result.manifestPatches, backupDir);
      logger.info('State and journal saved');
    }

    return {
      ok: result.ok,
      executed: result.executed,
      skipped: result.skipped,
      errors: result.errors,
      diagnostics: plan.diagnostics,
      warnings,
      needsInstall: result.needsInstall,
      manifestPatches: result.manifestPatches,
      meta: backupMetadata ? {
        backupTimestamp: backupMetadata.timestamp,
        backupHasLock: backupMetadata.includes.lock,
        backupManifestsCount: backupMetadata.counts.manifests,
      } : undefined,
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Apply failed', { error: errorMessage });

    return {
      ok: false,
      executed: [],
      skipped: [],
      errors: [],
      diagnostics: [errorMessage],
      warnings,
      needsInstall: false,
      manifestPatches: [],
      preflight: {
        cancelled: false,
        warnings: preflight.warnings,
      },
    };
  }
}
