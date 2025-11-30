import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { join } from 'node:path';
import { apply } from '../../api';
import { readJson } from '../filesystem/fs';
import {
  keyValue,
  formatTiming,
  safeSymbols,
  safeColors,
  displayArtifactsCompact,
} from '@kb-labs/shared-cli-ui';
import { discoverArtifacts } from '@devlink/application/devlink/legacy/status';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';

type DevlinkApplyFlags = {
  cwd: { type: 'string'; description?: string };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean };
  yes: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkApplyResult = CommandResult & {
  executed?: number;
  skipped?: number;
  errors?: number;
  needsInstall?: boolean;
  diagnostics?: string[];
};

export const run = defineCommand<DevlinkApplyFlags, DevlinkApplyResult>({
  name: 'devlink:apply',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    'dry-run': {
      type: 'boolean',
      description: 'Show what would be applied without making changes',
      default: false,
    },
    yes: {
      type: 'boolean',
      description: 'Skip confirmation prompts',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.APPLY_STARTED,
    finishEvent: ANALYTICS_EVENTS.APPLY_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : ctx.workdir;
    const dryRun = !!flags['dry-run'];
    const yes = !!flags.yes;

    ctx.tracker.checkpoint('read-plan');

    // Read plan from last-plan.json
    const lastPlanPath = join(cwd, '.kb', 'devlink', 'last-plan.json');
    const planData = await readJson(lastPlanPath);

    ctx.tracker.checkpoint('apply');

    const result = await apply(planData, {
      dryRun,
      yes,
    });

    const totalTime = ctx.tracker.total();

    if (flags.json) {
      ctx.output.json({
        ok: result.ok,
        executed: result.executed.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
        diagnostics: result.diagnostics,
        needsInstall: result.needsInstall,
        timing: totalTime,
      });
    } else {
      const summary = keyValue({
        'Executed': result.executed.length,
        'Skipped': result.skipped.length,
        'Errors': result.errors.length,
        'Needs Install': result.needsInstall ? 'Yes' : 'No',
        'Mode': dryRun ? 'Dry Run' : 'Apply',
      });

      // Show artifacts after apply
      const artifacts = await discoverArtifacts(cwd);
      const artifactsInfo = displayArtifactsCompact(artifacts, { maxItems: 5 });

      const { ui } = ctx.output;
      const output = ui.box('DevLink Apply', [...summary, '', `Time: ${formatTiming(totalTime)}`, ...artifactsInfo]);
      ctx.output.write(output);

      if (result.needsInstall) {
        ctx.output.write('');
        ctx.output.write(`${safeColors.warning('⚠️')} Run: pnpm install`);
      }

      if (result.diagnostics && result.diagnostics.length > 0) {
        ctx.output.write('');
        ctx.output.write(safeColors.info('Diagnostics:'));
        result.diagnostics.forEach(msg =>
          ctx.output.write(`  ${safeSymbols.info} ${msg}`)
        );
      }

      if (result.warnings && result.warnings.length > 0) {
        ctx.output.write('');
        ctx.output.write(safeColors.warning('Warnings:'));
        result.warnings.forEach(msg =>
          ctx.output.write(`  ${safeSymbols.warning} ${msg}`)
        );
      }
    }

    return {
      ok: result.ok,
      executed: result.executed.length,
      skipped: result.skipped.length,
      errors: result.errors.length,
      needsInstall: result.needsInstall,
      diagnostics: result.diagnostics,
    };
  },
});
