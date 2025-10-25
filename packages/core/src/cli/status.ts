import type { CommandModule } from './types';
import { status } from '../api';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  try {
    const cwd = flags.cwd ?? process.cwd();
    const result = await status({
      rootDir: cwd,
      roots: flags.roots ? flags.roots.split(',') : undefined,
      consumer: flags.consumer,
      warningLevel: flags.warningLevel as any,
    });

    if (flags.json) {
      ctx.presenter.json(result);
    } else {
      ctx.presenter.write(`Mode: ${result.context.mode}`);
      ctx.presenter.write(`Last operation: ${result.context.lastOperation}`);
      ctx.presenter.write(`Consumers: ${result.lock.consumers}`);
      ctx.presenter.write(`Dependencies: ${result.lock.deps}`);
      if (result.warnings.length > 0) {
        ctx.presenter.write(`Warnings: ${result.warnings.length}`);
      }
      if (result.suggestions.length > 0) {
        ctx.presenter.write(`Suggestions: ${result.suggestions.length}`);
      }
    }

    return result.ok ? 0 : 1;
  } catch (e: any) {
    if (flags.json) {
      ctx.presenter.json({ ok: false, error: e?.message });
    } else {
      ctx.presenter.error(e?.message ?? 'status failed');
    }
    return 1;
  }
};
