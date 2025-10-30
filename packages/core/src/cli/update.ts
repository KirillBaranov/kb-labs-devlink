import type { CommandModule } from './types';
import { scanAndPlan, apply } from '../api';
import { box, keyValue, formatTiming, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
import { Loader } from '@kb-labs/shared-cli-ui';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const startTime = Date.now();
  const jsonMode = !!flags.json;
  
  try {
    // Parse flags with defaults
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
    const mode = (flags.mode as 'npm' | 'local' | 'auto') ?? 'auto';
    const force = !!flags.force;
    const yes = !!flags.yes;
    const dryRun = !!(flags['dry-run'] || flags.dryRun);
    
    const loader = new Loader({ 
      text: 'Scanning workspace...', 
      spinner: false, // Отключаем спиннер
      jsonMode 
    });
    
    if (!jsonMode) {
      loader.start();
    }
    
    // Step 1: Scan and plan with upgrade mode
    const scanResult = await scanAndPlan({
      rootDir: cwd,
      mode,
      upgrade: 'latest',
    });
    
    if (!scanResult.ok) {
      loader.fail('Scan failed');
      if (jsonMode) {
        ctx.presenter.json({ ok: false, error: 'Scan failed', diagnostics: scanResult.diagnostics });
      } else {
        ctx.presenter.error('Failed to scan workspace');
        scanResult.diagnostics.forEach(msg => ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`));
      }
      return 1;
    }
    
    loader.update({ text: 'Planning updates...' });
    
    // Step 2: Apply the plan with timeout and progress
    const applyPromise = apply(scanResult.plan!, {
      yes,
      dryRun,
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timed out after 30 seconds')), 30000);
    });
    
    if (!jsonMode) {
      loader.stop();
      ctx.presenter.write('');
      ctx.presenter.write(safeColors.info('→') + ' Starting update operation...');
      ctx.presenter.write(safeColors.dim('  This may take a while due to yalc operations'));
      ctx.presenter.write('');
      
      // Создаем новый лоадер для apply операции
      const applyLoader = new Loader({ 
        text: 'Applying updates...', 
        spinner: true, 
        jsonMode: false 
      });
      applyLoader.start();
      
      // Останавливаем лоадер при завершении
      const cleanup = () => {
        applyLoader.stop();
      };
      
      // Привязываем cleanup к завершению операции
      applyPromise.finally(cleanup);
      timeoutPromise.finally(cleanup);
    }
    
    const applyResult = await Promise.race([applyPromise, timeoutPromise]) as any;
    
    const totalTime = Date.now() - startTime;
    
    if (jsonMode) {
      ctx.presenter.json({
        ok: applyResult.ok,
        operation: 'update',
        summary: {
          updated: applyResult.executed.length,
          skipped: applyResult.skipped.length,
          errors: applyResult.errors.length,
        },
        timings: {
          discovery: scanResult.timings?.discovery || 0,
          plan: scanResult.timings?.plan || 0,
          apply: totalTime - (scanResult.timings?.discovery || 0) - (scanResult.timings?.plan || 0),
          total: totalTime,
        },
        diagnostics: applyResult.diagnostics || [],
      });
    } else {
      if (applyResult.ok) {
        loader.succeed('Update complete');
        
        const summary = keyValue({
          'Updated': applyResult.executed.length,
          'Skipped': applyResult.skipped.length,
          'Strategy': 'latest',
          'Files': `${applyResult.executed.length} package.json files`,
          'Time': formatTiming(totalTime),
        });
        
        const output = box('Update Dependencies', summary);
        ctx.presenter.write(output);
        
        if (applyResult.needsInstall) {
          ctx.presenter.write('');
          ctx.presenter.write(safeColors.warning('⚠️  Run: pnpm install'));
        }
        
        if (applyResult.diagnostics && applyResult.diagnostics.length > 0) {
          ctx.presenter.write('');
          ctx.presenter.write(safeColors.warning('Diagnostics:'));
          applyResult.diagnostics.forEach(msg => 
            ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      } else {
        loader.fail('Update failed');
        ctx.presenter.error('Failed to update dependencies');
        if (applyResult.errors && applyResult.errors.length > 0) {
          ctx.presenter.write(safeColors.error('Errors:'));
          applyResult.errors.forEach(error => 
            ctx.presenter.write(`  ${safeColors.dim('•')} ${error}`)
          );
        }
        if (applyResult.diagnostics) {
          applyResult.diagnostics.forEach(msg => 
            ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      }
    }

    return applyResult.ok ? 0 : 1;
  } catch (e: unknown) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    if (jsonMode) {
      ctx.presenter.json({ ok: false, error: errorMessage });
    } else {
      ctx.presenter.error(errorMessage);
    }
    return 1;
  }
};
