import type { CommandModule } from './types';
import { scanAndPlan } from '../api';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  try {
    const cwd = flags.cwd ?? process.cwd();
    const result = await scanAndPlan({
      rootDir: cwd,
      mode: flags.mode ?? 'auto',
      roots: flags.roots ? flags.roots.split(',') : undefined,
      strict: flags.strict,
    });

    if (flags.json) {
      ctx.presenter.json({
        ok: result.ok,
        plan: result.plan,
        diagnostics: result.diagnostics,
        timings: result.timings,
      });
    } else {
      ctx.presenter.info('DevLink plan:');
      if (result.plan) {
        ctx.presenter.write(`Actions: ${result.plan.actions.length}`);
        if (result.diagnostics.length > 0) {
          ctx.presenter.write(`Diagnostics: ${result.diagnostics.join(', ')}`);
        }
      } else {
        ctx.presenter.error('Failed to create plan');
        if (result.diagnostics.length > 0) {
          result.diagnostics.forEach(msg => ctx.presenter.write(`  - ${msg}`));
        }
      }
    }

    return result.ok ? 0 : 1;
  } catch (e: any) {
    if (flags.json) {
      ctx.presenter.json({ ok: false, error: e?.message });
    } else {
      ctx.presenter.error(e?.message ?? 'makePlan failed');
    }
    return 1;
  }
};
