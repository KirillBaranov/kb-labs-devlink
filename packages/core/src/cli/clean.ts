import type { CommandModule } from './types';
import { clean } from '../clean';
import { box, keyValue, formatTiming, TimingTracker, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const tracker = new TimingTracker();
  const jsonMode = !!flags.json;
  
  try {
    // Parse flags with defaults
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
    const hard = !!flags.hard;
    const deep = !!flags.deep;
    
    tracker.checkpoint('clean');
    
    const result = await clean(cwd, { hard, deep });

    const totalTime = tracker.total();

    if (jsonMode) {
      ctx.presenter.json({
        ok: true,
        removed: result.removed,
        hard,
        deep,
        timing: totalTime,
      });
    } else {
      const summary = keyValue({
        'Removed': result.removed.length,
        'Hard Mode': hard ? 'Yes' : 'No',
        'Deep Clean': deep ? 'Yes' : 'No',
      });

      const output = box('DevLink Clean', [...summary, '', `Time: ${formatTiming(totalTime)}`]);
      ctx.presenter.write(output);
      
      if (result.removed.length > 0) {
        ctx.presenter.write('');
        ctx.presenter.write(safeColors.info('Removed files:'));
        result.removed.forEach(file => 
          ctx.presenter.write(`  ${safeSymbols.success} ${file}`)
        );
      } else {
        ctx.presenter.write('');
        ctx.presenter.write(`${safeSymbols.info} No files to clean`);
      }
      
      if (hard) {
        ctx.presenter.write('');
        ctx.presenter.write(safeColors.warning('⚠️  Hard mode: lock file removed'));
      }
      
      if (deep) {
        ctx.presenter.write('');
        ctx.presenter.write(safeColors.warning('⚠️  Deep mode: global yalc store cleaned'));
      }
    }

    return 0;
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
