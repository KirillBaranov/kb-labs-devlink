import type { CommandModule } from './types';
import type { z } from 'zod';
import { undo } from '../../api';
import { box, keyValue, formatTiming, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
import { Loader } from '@kb-labs/shared-cli-ui';
import { runScope } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';
import { resolveWorkspaceRoot } from '@kb-labs/core-workspace';
import { DevlinkUndoCommandInputSchema } from '@kb-labs/devlink-contracts/schema';
import { parseCommandFlags } from './utils';

type UndoCommandFlags = z.infer<typeof DevlinkUndoCommandInputSchema>;

export const run: CommandModule<UndoCommandFlags>['run'] = async (ctx, _argv, rawFlags) => {
  const startTime = Date.now();
  const jsonMode = !!(rawFlags as UndoCommandFlags | undefined)?.json;
  const flags = parseCommandFlags(DevlinkUndoCommandInputSchema, rawFlags, {
    ctx,
    command: 'devlink undo',
    jsonMode,
  });

  if (!flags) {
    return 1;
  }

  const requestedCwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : undefined;
  const workspaceResolution = await resolveWorkspaceRoot({
    cwd: requestedCwd,
    startDir: requestedCwd ?? process.cwd(),
  });
  const cwd = workspaceResolution.rootDir;
  
  const exitCode = await runScope(
    {
      actor: ANALYTICS_ACTOR,
      ctx: { workspace: cwd, workspaceSource: workspaceResolution.source },
    },
    async (emit) => {
      const dryRun = !!(flags['dry-run'] || flags.dryRun);

      try {
    
        // Track command start
        await emit({
          type: ANALYTICS_EVENTS.UNDO_STARTED,
          payload: {
            dryRun,
          },
        });
        
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

        // Track command completion
        await emit({
          type: ANALYTICS_EVENTS.UNDO_FINISHED,
          payload: {
            dryRun,
            reverted: result.reverted,
            operationType: result.operationType || 'unknown',
            durationMs: totalTime,
            result: result.ok ? 'success' : 'failed',
          },
        });

        return result.ok ? 0 : 1;
      } catch (e: any) {
        const totalTime = Date.now() - startTime;
        
        // Track command failure
        await emit({
          type: ANALYTICS_EVENTS.UNDO_FINISHED,
          payload: {
            dryRun,
            durationMs: totalTime,
            result: 'error',
            error: e?.message ?? 'Undo failed',
          },
        });
        
        if (jsonMode) {
          ctx.presenter.json({ ok: false, error: e?.message });
        } else {
          ctx.presenter.error(e?.message ?? 'Undo failed');
        }
        return 1;
      }
    }
  );

  return exitCode as number | void;
};
