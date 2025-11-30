import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { scanAndPlan } from '../rest';
import { freeze } from '../rest';
import { keyValue, formatTiming, safeColors, displayArtifactsCompact, Loader } from '@kb-labs/shared-cli-ui';
import { discoverArtifacts, determineMode } from '../core/operations/status';
import type { DevLinkMode } from '../core/operations/types';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../infrastructure/analytics/events';
import { resolveWorkspaceRoot } from '@kb-labs/core-workspace';

type DevlinkFreezeFlags = {
  cwd: { type: 'string'; description?: string };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean };
  merge: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkFreezeResult = CommandResult & {
  packagesLocked?: number;
  dependencies?: number;
  backupDir?: string;
  diagnostics?: string[];
};

export const run = defineCommand<DevlinkFreezeFlags, DevlinkFreezeResult>({
  name: 'devlink:freeze',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Show what would be frozen without making changes',
      default: false,
    },
    merge: {
      type: 'boolean',
      description: 'Merge with existing lock instead of replacing',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.FREEZE_STARTED,
    finishEvent: ANALYTICS_EVENTS.FREEZE_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const startTime = Date.now();
    const requestedCwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : undefined;
    const workspaceResolution = await resolveWorkspaceRoot({
      cwd: requestedCwd,
      startDir: requestedCwd ?? ctx.workdir,
    });
    const cwd = workspaceResolution.rootDir;

    const dryRun = !!flags['dry-run'];
    const merge = !!flags.merge;

    const loader = new Loader({
      text: 'Scanning workspace...',
      spinner: true,
      jsonMode: flags.json,
    });

    if (!flags.json) {
      loader.start();
    }

    // Determine current mode from state/lock
    const { mode } = await determineMode(cwd);
    const currentMode: DevLinkMode = (() => {
      if (mode === 'unknown') { return 'auto'; }
      if (mode === 'yalc') { return 'local'; }
      if (mode === 'remote') { return 'npm'; }
      return mode as DevLinkMode;
    })();

    // Step 1: Scan and plan with current mode
    const scanResult = await scanAndPlan({
      rootDir: cwd,
      mode: currentMode,
    });

    if (!scanResult.ok) {
      loader.fail('Scan failed');
      if (flags.json) {
        ctx.output.json({ ok: false, error: 'Scan failed', diagnostics: scanResult.diagnostics });
      } else {
        ctx.output.error(new Error('Failed to scan workspace'));
        scanResult.diagnostics.forEach(msg => ctx.output.write(`  ${safeColors.dim('•')} ${msg}`));
      }
      return {
        ok: false,
        error: 'Scan failed',
        diagnostics: scanResult.diagnostics,
      };
    }

    loader.update({ text: 'Building freeze plan...' });

    // Step 2: Freeze
    const freezeResult = await freeze(scanResult.plan!, {
      cwd,
      dryRun,
      replace: !merge,
    });

    const totalTime = Date.now() - startTime;

    if (flags.json) {
      ctx.output.json({
        ok: freezeResult.ok,
        operation: 'freeze',
        summary: {
          packagesLocked: freezeResult.meta?.packagesCount || 0,
          dependencies: scanResult.plan?.actions.length || 0,
          pinStrategy: 'caret',
          backupDir: freezeResult.meta?.backupDir,
        },
        timings: {
          discovery: scanResult.timings?.discovery || 0,
          plan: scanResult.timings?.plan || 0,
          freeze: totalTime - (scanResult.timings?.discovery || 0) - (scanResult.timings?.plan || 0),
          total: totalTime,
        },
        diagnostics: freezeResult.diagnostics || [],
      });
    } else {
      loader.succeed('Freeze complete');

      if (freezeResult.ok) {
        const summary = keyValue({
          'Packages locked': freezeResult.meta?.packagesCount || 0,
          'Dependencies': scanResult.plan?.actions.length || 0,
          'Pin strategy': 'caret (^)',
          'Backup': freezeResult.meta?.backupDir ?
            freezeResult.meta.backupDir.split('/').pop() || 'unknown' : 'none',
          'Lock file': '.kb/devlink/lock.json',
          'Time': formatTiming(totalTime),
        });

        // Show artifacts after freeze
        const artifacts = await discoverArtifacts(cwd);
        const artifactsInfo = displayArtifactsCompact(artifacts, { maxItems: 5 });

        const { ui } = ctx.output;
        const output = ui.box('Freeze Workspace', [...summary, ...artifactsInfo]);
        ctx.output.write(output);

        if (freezeResult.diagnostics && freezeResult.diagnostics.length > 0) {
          ctx.output.write('');
          ctx.output.write(safeColors.warning('Diagnostics:'));
          freezeResult.diagnostics.forEach(msg =>
            ctx.output.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      } else {
        ctx.output.error(new Error('Freeze failed'));
        if (freezeResult.diagnostics) {
          freezeResult.diagnostics.forEach(msg =>
            ctx.output.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      }
    }

    return {
      ok: freezeResult.ok,
      packagesLocked: freezeResult.meta?.packagesCount || 0,
      dependencies: scanResult.plan?.actions.length || 0,
      backupDir: freezeResult.meta?.backupDir,
      diagnostics: freezeResult.diagnostics,
    };
  },
});
