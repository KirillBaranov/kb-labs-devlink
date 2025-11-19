import type { CommandModule } from './types';
import type { z } from 'zod';
import { join } from 'node:path';
import { apply } from '../../api';
import { readJson } from '../filesystem/fs';
import {
  box,
  keyValue,
  formatTiming,
  TimingTracker,
  safeSymbols,
  safeColors,
  displayArtifactsCompact,
} from '@kb-labs/shared-cli-ui';
import { discoverArtifacts } from '@devlink/application/devlink/legacy/status';
import { runScope } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';
import { DevlinkApplyCommandInputSchema } from '@kb-labs/devlink-contracts/schema';
import { parseCommandFlags } from './utils';

type ApplyCommandFlags = z.infer<typeof DevlinkApplyCommandInputSchema>;

export const run: CommandModule<ApplyCommandFlags>['run'] = async (ctx, _argv, rawFlags) => {
  const tracker = new TimingTracker();
  const jsonMode = !!(rawFlags as ApplyCommandFlags | undefined)?.json;
  const flags = parseCommandFlags(DevlinkApplyCommandInputSchema, rawFlags, {
    ctx,
    command: 'devlink apply',
    jsonMode,
  });

  if (!flags) {
    return 1;
  }

  const cwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : process.cwd();
  const dryRun = !!(flags['dry-run'] ?? flags.dryRun);
  const yes = !!flags.yes;

  const exitCode = await runScope(
    {
      actor: ANALYTICS_ACTOR,
      ctx: { workspace: cwd },
    },
    async (emit) => {
      try {
        // Track command start
        await emit({
          type: ANALYTICS_EVENTS.APPLY_STARTED,
          payload: {
            dryRun,
            yes,
          },
        });
        
        tracker.checkpoint('read-plan');
        
        // Read plan from last-plan.json
        const lastPlanPath = join(cwd, '.kb', 'devlink', 'last-plan.json');
        const planData = await readJson(lastPlanPath);

        tracker.checkpoint('apply');
        
        const result = await apply(planData, {
          dryRun,
          yes,
        });

        const totalTime = tracker.total();

        if (jsonMode) {
          ctx.presenter.json({
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

          const output = box('DevLink Apply', [...summary, '', `Time: ${formatTiming(totalTime)}`, ...artifactsInfo]);
          ctx.presenter.write(output);
          
          if (result.needsInstall) {
            ctx.presenter.write('');
            ctx.presenter.write(`${safeColors.warning('⚠️')} Run: pnpm install`);
          }
          
          if (result.diagnostics && result.diagnostics.length > 0) {
            ctx.presenter.write('');
            ctx.presenter.write(safeColors.info('Diagnostics:'));
            result.diagnostics.forEach(msg => 
              ctx.presenter.write(`  ${safeSymbols.info} ${msg}`)
            );
          }
          
          if (result.warnings && result.warnings.length > 0) {
            ctx.presenter.write('');
            ctx.presenter.write(safeColors.warning('Warnings:'));
            result.warnings.forEach(msg => 
              ctx.presenter.write(`  ${safeSymbols.warning} ${msg}`)
            );
          }
        }

        // Track command completion
        await emit({
          type: ANALYTICS_EVENTS.APPLY_FINISHED,
          payload: {
            dryRun,
            yes,
            executed: result.executed.length,
            skipped: result.skipped.length,
            errors: result.errors.length,
            needsInstall: result.needsInstall,
            durationMs: totalTime,
            result: result.ok ? 'success' : 'failed',
          },
        });

        return result.ok ? 0 : 1;
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        const totalTime = tracker.total();
        
        // Track command failure
        await emit({
          type: ANALYTICS_EVENTS.APPLY_FINISHED,
          payload: {
            dryRun,
            yes,
            durationMs: totalTime,
            result: 'error',
            error: errorMessage,
          },
        });
        
        if (jsonMode) {
          ctx.presenter.json({ ok: false, error: errorMessage, timing: totalTime });
        } else {
          ctx.presenter.error(errorMessage);
        }
        return 1;
      }
    }
  );

  return exitCode as number | void;
};
