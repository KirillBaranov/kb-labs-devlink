import type { CommandModule } from './types';
import { scanAndPlan } from '../api';
import { box, keyValue, formatTiming, TimingTracker, displayArtifactsCompact } from '@kb-labs/shared-cli-ui';
import { discoverArtifacts } from '../devlink/status';
import { writeJson } from '../utils/fs';
import { join } from 'node:path';
import { runScope } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../analytics/events';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const tracker = new TimingTracker();
  const jsonMode = !!flags.json;
  const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
  
  return await runScope(
    {
      actor: ANALYTICS_ACTOR,
      ctx: { workspace: cwd },
    },
    async (emit) => {
      try {
        // Parse flags with defaults (following template pattern)
        const mode = flags.mode ?? 'auto';
        const roots = flags.roots ? flags.roots.split(',') : undefined;
        const strict = !!flags.strict;
        
        // Track command start
        await emit({
          type: ANALYTICS_EVENTS.PLAN_STARTED,
          payload: {
            mode,
            roots: roots?.join(','),
            strict,
          },
        });
        
        tracker.checkpoint('scan');
        
        const result = await scanAndPlan({
          rootDir: cwd,
          mode,
          roots,
          strict,
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
            mode: flags.mode ?? 'auto',
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
};
