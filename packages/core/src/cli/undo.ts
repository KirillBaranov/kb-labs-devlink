import type { CommandModule } from './types';
import { undo } from '../api';
import { box, keyValue, formatTiming, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
import { Loader } from '@kb-labs/shared-cli-ui';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const startTime = Date.now();
  const jsonMode = !!flags.json;
  
  try {
    // Parse flags with defaults
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
    const dryRun = !!flags['dry-run'];
    
    const loader = new Loader({ 
      text: 'Reading journal...', 
      spinner: true, 
      jsonMode 
    });
    
    if (!jsonMode) {
      loader.start();
    }
    
    // Execute undo
    const result = await undo({
      rootDir: cwd,
      dryRun,
    });
    
    const totalTime = Date.now() - startTime;
    
    if (jsonMode) {
      ctx.presenter.json({
        ok: result.ok,
        operation: 'undo',
        summary: {
          reverted: result.reverted,
          operationType: result.operationType,
          details: result.details,
        },
        timings: {
          total: totalTime,
        },
        diagnostics: result.diagnostics || [],
        warnings: result.warnings || [],
      });
    } else {
      if (result.ok) {
        loader.succeed('Undo complete');
        
        const summary = keyValue({
          'Reverted': result.reverted,
          'Type': result.operationType || 'unknown',
          'From': result.details?.backupDir ? 
            result.details.backupDir.split('/').pop() : 'backup',
          'Time': formatTiming(totalTime),
        });
        
        const output = box('Undo Last Operation', summary);
        ctx.presenter.write(output);
        
        if (result.warnings && result.warnings.length > 0) {
          ctx.presenter.write('');
          ctx.presenter.write(safeColors.warning('Warnings:'));
          result.warnings.forEach(msg => 
            ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      } else {
        loader.fail('Undo failed');
        ctx.presenter.error('Failed to undo last operation');
        if (result.diagnostics) {
          result.diagnostics.forEach(msg => 
            ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      }
    }

    return result.ok ? 0 : 1;
  } catch (e: any) {
    if (jsonMode) {
      ctx.presenter.json({ ok: false, error: e?.message });
    } else {
      ctx.presenter.error(e?.message ?? 'Undo failed');
    }
    return 1;
  }
};
