import type { CommandModule } from './types';
import { status } from '../api';
import { box, keyValue, formatTiming, formatRelativeTime, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  try {
    // Parse flags with defaults
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
    const roots = flags.roots ? flags.roots.split(',') : undefined;
    const consumer = flags.consumer;
    const warningLevel = flags.warningLevel as any;
    
    const result = await status({
      rootDir: cwd,
      roots,
      consumer,
      warningLevel,
    });

    if (flags.json) {
      ctx.presenter.json(result);
    } else {
      // Build status summary
      const workspaceInfo = keyValue({
        'Workspace': cwd.split('/').pop() || cwd,
        'Mode': result.context.mode,
        'Last op': result.context.lastOperation === 'none' ? 'none' : 
          `${result.context.lastOperation} (${formatRelativeTime(result.context.lastOperationTs || new Date())})`,
      });
      
      const lockInfo = keyValue({
        'Consumers': result.lock.consumers,
        'Dependencies': result.lock.deps,
        'Generated': result.lock.generatedAt ? 
          formatRelativeTime(result.lock.generatedAt) : 'never',
      });
      
      const healthInfo = result.warnings.length === 0 
        ? [`${safeSymbols.success} No warnings`]
        : result.warnings.map(w => 
            `${w.severity === 'error' ? safeSymbols.error : safeSymbols.warning} ${w.message}`
          );
      
      const sections = [
        safeColors.bold('Workspace:'),
        ...workspaceInfo,
        '',
        safeColors.bold('Lock File:'),
        ...lockInfo,
        '',
        safeColors.bold('Health:'),
        ...healthInfo,
      ];
      
      const output = box('DevLink Status', sections);
      ctx.presenter.write(output);
      
      if (result.suggestions.length > 0) {
        ctx.presenter.write('');
        ctx.presenter.write(safeColors.info('Suggestions:'));
        result.suggestions.forEach(suggestion => 
          ctx.presenter.write(`  ${safeColors.dim('•')} ${suggestion.description}`)
        );
      }
      
      if (result.timings) {
        ctx.presenter.write('');
        ctx.presenter.write(safeColors.dim(`Status check: ${formatTiming(result.timings.total)}`));
      }
    }

    return result.ok ? 0 : 1;
  } catch (e: any) {
    if (flags.json) {
      ctx.presenter.json({ ok: false, error: e?.message });
    } else {
      ctx.presenter.error(e?.message ?? 'Status failed');
    }
    return 1;
  }
};
