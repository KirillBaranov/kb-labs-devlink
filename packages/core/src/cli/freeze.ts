import type { CommandModule } from './types';
import { scanAndPlan } from '../api';
import { freeze } from '../api';
import { box, keyValue, formatTiming, safeSymbols, safeColors, displayArtifactsCompact, Loader } from '@kb-labs/shared-cli-ui';
import { discoverArtifacts, determineMode } from '../devlink/status';
import { runScope } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../analytics/events';

export const run: CommandModule['run'] = async (ctx, _argv, flags) => {
  const startTime = Date.now();
  const jsonMode = !!flags.json;
  const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
  
  return await runScope(
    {
      actor: ANALYTICS_ACTOR,
      ctx: { workspace: cwd },
    },
    async (emit) => {
      try {
        // Parse flags with defaults
        const dryRun = !!flags['dry-run'];
        const merge = !!flags.merge;
    
        // Track command start
        await emit({
          type: ANALYTICS_EVENTS.FREEZE_STARTED,
          payload: {
            dryRun,
            merge,
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
        
        // Determine current mode from state/lock
        const { mode } = await determineMode(cwd);
        const currentMode = mode === 'unknown' ? 'auto' : mode;
        
        // Step 1: Scan and plan with current mode
        const scanResult = await scanAndPlan({
          rootDir: cwd,
          mode: currentMode,
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
        
        loader.update({ text: 'Building freeze plan...' });
    
        // Step 2: Freeze
        const freezeResult = await freeze(scanResult.plan!, {
          cwd,
          dryRun,
          replace: !merge,
        });
        
        const totalTime = Date.now() - startTime;
    
        if (jsonMode) {
          ctx.presenter.json({
            ok: freezeResult.ok,
            operation: 'freeze',
            summary: {
              packagesLocked: freezeResult.meta?.packagesCount || 0,
              dependencies: scanResult.plan?.actions.length || 0,
              pinStrategy: 'caret',
              backupDir: freezeResult.meta?.backupDir,
            },
            timings: {
              discovery: scanResult.timings?.discovery || 0,
              plan: scanResult.timings?.plan || 0,
              freeze: totalTime - (scanResult.timings?.discovery || 0) - (scanResult.timings?.plan || 0),
              total: totalTime,
            },
            diagnostics: freezeResult.diagnostics || [],
          });
        } else {
          loader.succeed('Freeze complete');
          
          if (freezeResult.ok) {
            const summary = keyValue({
              'Packages locked': freezeResult.meta?.packagesCount || 0,
              'Dependencies': scanResult.plan?.actions.length || 0,
              'Pin strategy': 'caret (^)',
              'Backup': freezeResult.meta?.backupDir ? 
                freezeResult.meta.backupDir.split('/').pop() || 'unknown' : 'none',
              'Lock file': '.kb/devlink/lock.json',
              'Time': formatTiming(totalTime),
            });
            
            // Show artifacts after freeze
            const artifacts = await discoverArtifacts(cwd);
            const artifactsInfo = displayArtifactsCompact(artifacts, { maxItems: 5 });
            
            const output = box('Freeze Workspace', [...summary, ...artifactsInfo]);
            ctx.presenter.write(output);
            
            if (freezeResult.diagnostics && freezeResult.diagnostics.length > 0) {
              ctx.presenter.write('');
              ctx.presenter.write(safeColors.warning('Diagnostics:'));
              freezeResult.diagnostics.forEach(msg => 
                ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
              );
            }
          } else {
            ctx.presenter.error('Freeze failed');
            if (freezeResult.diagnostics) {
              freezeResult.diagnostics.forEach(msg => 
                ctx.presenter.write(`  ${safeColors.dim('•')} ${msg}`)
              );
            }
          }
        }

        // Track command completion
        await emit({
          type: ANALYTICS_EVENTS.FREEZE_FINISHED,
          payload: {
            dryRun,
            merge,
            packagesLocked: freezeResult.meta?.packagesCount || 0,
            dependencies: scanResult.plan?.actions.length || 0,
            durationMs: totalTime,
            result: freezeResult.ok ? 'success' : 'failed',
          },
        });

        return freezeResult.ok ? 0 : 1;
      } catch (e: any) {
        const totalTime = Date.now() - startTime;
        
        // Track command failure
        await emit({
          type: ANALYTICS_EVENTS.FREEZE_FINISHED,
          payload: {
            dryRun: !!flags['dry-run'],
            merge: !!flags.merge,
            durationMs: totalTime,
            result: 'error',
            error: e?.message ?? 'Freeze failed',
          },
        });
        
        if (jsonMode) {
          ctx.presenter.json({ ok: false, error: e?.message });
        } else {
          ctx.presenter.error(e?.message ?? 'Freeze failed');
        }
        return 1;
      }
    }
  );
};
