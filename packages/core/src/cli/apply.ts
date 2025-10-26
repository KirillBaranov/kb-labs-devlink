import type { CommandModule } from './types';
import { apply } from '../api';
import { readJson } from '../utils/fs';
import { join } from 'node:path';
import { box, keyValue, formatTiming, TimingTracker } from '@kb-labs/shared-cli-ui';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const tracker = new TimingTracker();
  const jsonMode = !!flags.json;
  
  try {
    // Parse flags with defaults (following template pattern)
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
    const dryRun = !!flags.dryRun;
    const yes = !!flags.yes;
    
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

      const output = box('DevLink Apply', [...summary, '', `Time: ${formatTiming(totalTime)}`]);
      ctx.presenter.write(output);
      
      if (result.needsInstall) {
        ctx.presenter.write('');
        ctx.presenter.write('⚠️  Run: pnpm install');
      }
      
      if (result.diagnostics && result.diagnostics.length > 0) {
        ctx.presenter.write('');
        ctx.presenter.write('Diagnostics:');
        result.diagnostics.forEach(msg => 
          ctx.presenter.write(`  • ${msg}`)
        );
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
