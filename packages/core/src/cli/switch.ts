import type { CommandModule } from './types';
import { scanAndPlan, apply } from '../api';
import { box, keyValue, formatTiming, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
import { Loader } from '@kb-labs/shared-cli-ui';
import { runScope, type AnalyticsEventV1, type EmitResult } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../analytics/events';

export const run: CommandModule['run'] = async (ctx, _argv, flags): Promise<number | void> => {
  const startTime = Date.now();
  const jsonMode = !!flags.json;
  const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
  
  return (await runScope(
    {
      actor: ANALYTICS_ACTOR,
      ctx: { workspace: cwd },
    },
    async (emit: (event: Partial<AnalyticsEventV1>) => Promise<EmitResult>): Promise<number | void> => {
      try {
        // Parse flags with defaults
        const mode = flags.mode as 'npm' | 'local' | 'auto';
        const force = !!flags.force;
        const yes = !!flags.yes;
        const dryRun = !!(flags['dry-run'] || flags.dryRun);
    
        if (!mode) {
          ctx.presenter.error('Mode is required. Use --mode npm|local|auto');
          return 1;
        }
        
        // Track command start
        await emit({
          type: ANALYTICS_EVENTS.SWITCH_STARTED,
          payload: {
            mode,
            force,
            yes,
            dryRun,
          },
        });
        
        const loader = new Loader({ 
          text: 'Scanning workspace...', 
          spinner: true, 
          jsonMode 
        });
        
        if (!jsonMode) {
          loader.start();
        }
        
        // Step 1: Scan and plan with new mode
        const scanResult = await scanAndPlan({
          rootDir: cwd,
          mode,
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
        
        loader.update({ text: 'Planning changes...' });
        
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
          ctx.presenter.write(safeColors.info('→') + ' Starting apply operation...');
          ctx.presenter.write(safeColors.dim('  This may take a while due to yalc operations'));
          ctx.presenter.write('');
          
          // Создаем новый лоадер для apply операции
          const applyLoader = new Loader({ 
            text: 'Applying changes...', 
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
            operation: 'switch',
            summary: {
              mode,
              switched: applyResult.executed.length,
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
            loader.succeed('Mode switched');
            
            const summary = keyValue({
              'Switched': applyResult.executed.length,
              'Skipped': applyResult.skipped.length,
              'Mode': mode,
              'Updated': `${applyResult.executed.length} package.json files`,
              'Time': formatTiming(totalTime),
            });
            
            const output = box(`Switch Mode: ${mode}`, summary);
            ctx.presenter.write(output);
            
            if (applyResult.needsInstall) {
              ctx.presenter.write('');
              ctx.presenter.write(safeColors.warning('⚠️  Run: pnpm install'));
            }
            
            if (applyResult.diagnostics && applyResult.diagnostics.length > 0) {
              ctx.presenter.write('');
              ctx.presenter.write(safeColors.warning('Diagnostics:'));
              applyResult.diagnostics.forEach((msg: string) => 
                ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
              );
            }
          } else {
            loader.fail('Switch failed');
            ctx.presenter.error('Failed to switch mode');
            if (applyResult.errors && applyResult.errors.length > 0) {
              ctx.presenter.write(safeColors.error('Errors:'));
              applyResult.errors.forEach((error: any) => 
                ctx.presenter.write(`  ${safeColors.dim('•')} ${error}`)
              );
            }
            if (applyResult.diagnostics) {
              applyResult.diagnostics.forEach((msg: string) => 
                ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
              );
            }
          }
        }

        // Track command completion
        await emit({
          type: ANALYTICS_EVENTS.SWITCH_FINISHED,
          payload: {
            mode,
            force,
            yes,
            dryRun,
            switched: applyResult.executed.length,
            skipped: applyResult.skipped.length,
            errors: applyResult.errors.length,
            durationMs: totalTime,
            result: applyResult.ok ? 'success' : 'failed',
          },
        });

        return applyResult.ok ? 0 : 1;
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        const totalTime = Date.now() - startTime;
        
        // Track command failure
        await emit({
          type: ANALYTICS_EVENTS.SWITCH_FINISHED,
          payload: {
            mode: flags.mode as string,
            force: !!flags.force,
            yes: !!flags.yes,
            dryRun: !!(flags['dry-run'] || flags.dryRun),
            durationMs: totalTime,
            result: 'error',
            error: errorMessage,
          },
        });
        
        if (jsonMode) {
          ctx.presenter.json({ ok: false, error: errorMessage });
        } else {
          ctx.presenter.error(errorMessage);
        }
        return 1;
      }
    }
  )) as number | void;
};
