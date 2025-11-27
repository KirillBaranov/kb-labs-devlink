import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { undo } from '../../api';
import { keyValue, formatTiming, safeColors } from '@kb-labs/shared-cli-ui';
import { Loader } from '@kb-labs/shared-cli-ui';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';
import { resolveWorkspaceRoot } from '@kb-labs/core-workspace';

type DevlinkUndoFlags = {
  cwd: { type: 'string'; description?: string };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean };
  dryRun: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkUndoResult = CommandResult & {
  reverted?: boolean;
  operationType?: string;
  details?: any;
  diagnostics?: string[];
  warnings?: string[];
};

export const run = defineCommand<DevlinkUndoFlags, DevlinkUndoResult>({
  name: 'devlink:undo',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview changes without executing',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview changes without executing',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output diagnostics in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.UNDO_STARTED,
    finishEvent: ANALYTICS_EVENTS.UNDO_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const requestedCwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : undefined;
    const workspaceResolution = await resolveWorkspaceRoot({
      cwd: requestedCwd,
      startDir: requestedCwd ?? process.cwd(),
    });
    const cwd = workspaceResolution.rootDir;
    const dryRun = !!(flags['dry-run'] || flags.dryRun);
    const jsonMode = !!flags.json;

    const loader = new Loader({
      text: 'Reading journal...',
      spinner: true,
      jsonMode
    });

    if (!jsonMode) {
      loader.start();
    }

    // Execute undo
    const result = await undo({
      rootDir: cwd,
      dryRun,
    });

    const totalTime = ctx.tracker.total();

    if (jsonMode) {
      ctx.output?.json({
        ok: result.ok,
        operation: 'undo',
        summary: {
          reverted: result.reverted,
          operationType: result.operationType,
          details: result.details,
        },
        timings: {
          total: totalTime,
        },
        diagnostics: result.diagnostics || [],
        warnings: result.warnings || [],
      });
    } else {
      if (result.ok) {
        loader.succeed('Undo complete');

        const summary = keyValue({
          'Reverted': result.reverted,
          'Type': result.operationType || 'unknown',
          'From': result.details?.backupDir ?
            result.details.backupDir.split('/').pop() : 'backup',
          'Time': formatTiming(totalTime),
        });

        const { ui } = ctx.output!;
        const output = ui.box('Undo Last Operation', summary);
        ctx.output?.write(output);

        if (result.warnings && result.warnings.length > 0) {
          ctx.output?.write('');
          ctx.output?.write(safeColors.warning('Warnings:'));
          result.warnings.forEach(msg =>
            ctx.output?.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      } else {
        loader.fail('Undo failed');
        ctx.output?.error(new Error('Failed to undo last operation'));
        if (result.diagnostics) {
          result.diagnostics.forEach(msg =>
            ctx.output?.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      }
    }

    return {
      ok: result.ok,
      reverted: result.reverted,
      operationType: result.operationType,
      details: result.details,
      diagnostics: result.diagnostics,
      warnings: result.warnings,
    };
  },
});
