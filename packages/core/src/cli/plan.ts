import type { CommandModule } from './types';
import { scanAndPlan } from '../api';
import { box, keyValue, formatTiming, TimingTracker, displayArtifactsCompact } from '@kb-labs/shared-cli-ui';
import { discoverArtifacts } from '../devlink/status';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const tracker = new TimingTracker();
  const jsonMode = !!flags.json;
  
  try {
    // Parse flags with defaults (following template pattern)
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
    const mode = flags.mode ?? 'auto';
    const roots = flags.roots ? flags.roots.split(',') : undefined;
    const strict = !!flags.strict;
    
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

        // Show artifacts if plan was created
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

    return result.ok ? 0 : 1;
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (jsonMode) {
      ctx.presenter.json({ ok: false, error: errorMessage, timing: tracker.total() });
    } else {
      ctx.presenter.error(errorMessage);
    }
    return 1;
  }
};
