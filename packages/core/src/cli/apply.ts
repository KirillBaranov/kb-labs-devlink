import type { CommandModule } from './types';
import { apply } from '../api';
import { readJson } from '../utils/fs';
import { join } from 'node:path';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  try {
    const cwd = flags.cwd ?? process.cwd();
    
    // Read plan from last-plan.json
    const lastPlanPath = join(cwd, '.kb', 'devlink', 'last-plan.json');
    const planData = await readJson(lastPlanPath);

    const result = await apply(planData, {
      dryRun: flags.dryRun,
      yes: flags.yes,
    });

    if (flags.json) {
      ctx.presenter.json({
        ok: result.ok,
        executed: result.executed.length,
        skipped: result.skipped.length,
        errors: result.errors.length,
        diagnostics: result.diagnostics,
        needsInstall: result.needsInstall,
      });
    } else {
      ctx.presenter.info('DevLink apply:');
      ctx.presenter.write(`Executed: ${result.executed.length}`);
      ctx.presenter.write(`Skipped: ${result.skipped.length}`);
      if (result.errors.length > 0) {
        ctx.presenter.write(`Errors: ${result.errors.length}`);
      }
      if (result.needsInstall) {
        ctx.presenter.write('⚠️  Run: pnpm install');
      }
    }

    return result.ok ? 0 : 1;
  } catch (e: any) {
    if (flags.json) {
      ctx.presenter.json({ ok: false, error: e?.message });
    } else {
      ctx.presenter.error(e?.message ?? 'apply failed');
    }
    return 1;
  }
};
