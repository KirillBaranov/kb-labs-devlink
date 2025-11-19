import type { CommandModule } from './types';
import type { z } from 'zod';
import { join } from 'node:path';
import { scanAndPlan } from '../../api';
import { box, keyValue, formatTiming, TimingTracker, displayArtifactsCompact } from '@kb-labs/shared-cli-ui';
import { discoverArtifacts } from '@devlink/application/devlink/legacy/status';
import { writeJson } from '../filesystem/fs';
import { runScope } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';
import { resolveWorkspaceRoot } from '@kb-labs/core-workspace';
import { DevlinkPlanCommandInputSchema } from '@kb-labs/devlink-contracts/schema';
import { parseCommandFlags } from './utils';

type PlanCommandFlags = z.infer<typeof DevlinkPlanCommandInputSchema>;

export const run: CommandModule<PlanCommandFlags>['run'] = async (ctx, _argv, rawFlags) => {
  const jsonMode = !!(rawFlags as PlanCommandFlags | undefined)?.json;
  const flags = parseCommandFlags(DevlinkPlanCommandInputSchema, rawFlags, {
    ctx,
    command: 'devlink plan',
    jsonMode,
  });

  if (!flags) {
    return 1;
  }

  const tracker = new TimingTracker();
  const requestedCwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : undefined;
  const workspaceResolution = await resolveWorkspaceRoot({
    cwd: requestedCwd,
    startDir: requestedCwd ?? process.cwd(),
  });
  const cwd = workspaceResolution.rootDir;
  const mode = flags.mode ?? 'auto';
  const roots = flags.roots ? flags.roots.split(',') : undefined;
  const strict = !!flags.strict;
  const container = !!flags.container;

  const exitCode = await runScope(
    {
      actor: ANALYTICS_ACTOR,
      ctx: { workspace: cwd, workspaceSource: workspaceResolution.source },
    },
    async (emit) => {
        try {
          // Track command start
          await emit({
            type: ANALYTICS_EVENTS.PLAN_STARTED,
            payload: {
              mode,
              roots: roots?.join(','),
              strict,
              container,
            },
          });
          
          tracker.checkpoint('scan');
          
          const result = await scanAndPlan({
            rootDir: cwd,
            mode,
            roots,
            strict,
            container,
          });

          const totalTime = tracker.total();

          if (jsonMode) {
            ctx.presenter.json({
              ok: result.ok,
              plan: result.plan,
              diagnostics: result.diagnostics,
              timings: result.timings,
              totalTime,
            });
          } else {
            if (result.plan) {
              // Save plan to last-plan.json
              const lastPlanPath = join(cwd, '.kb', 'devlink', 'last-plan.json');
              await writeJson(lastPlanPath, result.plan);

              const summary = keyValue({
                'Mode': mode,
                'Actions': result.plan.actions.length,
                'Packages': Object.keys(result.plan.index.packages).length,
                'Diagnostics': result.diagnostics.length,
              });

              const timingInfo = [
                `Discovery: ${formatTiming(result.timings.discovery)}`,
                `Plan: ${formatTiming(result.timings.plan)}`,
                `Total: ${formatTiming(totalTime)}`,
              ];

              // Show artifacts after saving plan
              const artifacts = await discoverArtifacts(cwd);
              const artifactsInfo = displayArtifactsCompact(artifacts, { maxItems: 5 });

              const output = box('DevLink Plan', [...summary, '', ...timingInfo, ...artifactsInfo]);
              ctx.presenter.write(output);
              
              if (result.diagnostics.length > 0) {
                ctx.presenter.write('');
                ctx.presenter.write('Diagnostics:');
                result.diagnostics.forEach(msg => 
                  ctx.presenter.write(`  • ${msg}`)
                );
              }
            } else {
              ctx.presenter.error('Failed to create plan');
              if (result.diagnostics.length > 0) {
                ctx.presenter.write('');
                ctx.presenter.write('Diagnostics:');
                result.diagnostics.forEach(msg => 
                  ctx.presenter.write(`  • ${msg}`)
                );
              }
            }
          }

          // Track command completion
          await emit({
            type: ANALYTICS_EVENTS.PLAN_FINISHED,
            payload: {
              mode,
              roots: roots?.join(','),
              strict,
              container,
              actions: result.plan?.actions.length ?? 0,
              packages: Object.keys(result.plan?.index.packages ?? {}).length,
              diagnostics: result.diagnostics.length,
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
            type: ANALYTICS_EVENTS.PLAN_FINISHED,
            payload: {
              mode,
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
