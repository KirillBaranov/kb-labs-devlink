import type { CommandModule } from './types';
import { DevLinkWatcher } from '../api';
import { box, keyValue, formatTiming, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
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
        const mode = (flags.mode as 'npm' | 'local' | 'auto') ?? 'auto';
        const verbose = !!flags.verbose;
        const dryRun = !!(flags['dry-run'] || flags.dryRun);
        
        // Track command start
        await emit({
          type: ANALYTICS_EVENTS.WATCH_STARTED,
          payload: {
            mode,
            verbose,
            dryRun,
          },
        });
    
        if (jsonMode) {
          ctx.presenter.json({
            ok: true,
            operation: 'watch',
            summary: {
              mode,
              verbose,
              watching: true,
            },
            timings: {
              startTime: Date.now(),
            },
          });
          await emit({
            type: ANALYTICS_EVENTS.WATCH_FINISHED,
            payload: {
              mode,
              verbose,
              durationMs: Date.now() - startTime,
              result: 'success',
            },
          });
          return 0;
        }
        
        // Show initial status
        const statusInfo = keyValue({
          'Mode': mode,
          'Verbose': verbose ? 'enabled' : 'disabled',
          'Watching': 'Starting...',
        });
        
        const output = box('DevLink Watch', statusInfo);
        ctx.presenter.write(output);
        ctx.presenter.write('');
        
        // Create watcher
        const watcher = new DevLinkWatcher({
          rootDir: cwd,
          mode,
          verbose,
          dryRun,
        });
        
        let changeCount = 0;
        
        // Set up event handlers
        watcher.on('change', (event) => {
          changeCount++;
          const timestamp = new Date().toLocaleTimeString();
          
          ctx.presenter.write(`${safeColors.dim(`[${timestamp}]`)} ${safeColors.info('→')} Change detected: ${event.file}`);
          
          if (event.package) {
            ctx.presenter.write(`  ${safeColors.dim('•')} Package: ${event.package}`);
          }
          
          if (event.dependents && event.dependents.length > 0) {
            ctx.presenter.write(`  ${safeColors.dim('•')} Dependents: ${event.dependents.join(', ')}`);
          }
          
          ctx.presenter.write('');
        });
        
        watcher.on('rebuild', (event) => {
          const timestamp = new Date().toLocaleTimeString();
          ctx.presenter.write(`${safeColors.dim(`[${timestamp}]`)} ${safeColors.info('→')} Rebuilding ${event.package}...`);
        });
        
        watcher.on('rebuild-complete', (event) => {
          const timestamp = new Date().toLocaleTimeString();
          const duration = formatTiming(event.duration);
          ctx.presenter.write(`${safeColors.dim(`[${timestamp}]`)} ${safeSymbols.success} Rebuild complete (${duration})`);
          ctx.presenter.write('');
        });
        
        watcher.on('error', (error) => {
          const timestamp = new Date().toLocaleTimeString();
          ctx.presenter.write(`${safeColors.dim(`[${timestamp}]`)} ${safeSymbols.error} Error: ${error.message}`);
          ctx.presenter.write('');
        });
        
        watcher.on('ready', () => {
          const timestamp = new Date().toLocaleTimeString();
          ctx.presenter.write(`${safeColors.dim(`[${timestamp}]`)} ${safeSymbols.success} Watcher ready`);
          ctx.presenter.write('');
          ctx.presenter.write(safeColors.dim('Press Ctrl+C to stop'));
          ctx.presenter.write('');
        });
        
        // Start watching
        await watcher.start();
        
        // For dry-run, exit immediately after showing results
        if (dryRun) {
          const totalTime = Date.now() - startTime;
          await emit({
            type: ANALYTICS_EVENTS.WATCH_FINISHED,
            payload: {
              mode,
              verbose,
              changeCount,
              durationMs: totalTime,
              result: 'success',
            },
          });
          ctx.presenter.write('');
          ctx.presenter.write(safeColors.success('✓') + ' Dry-run complete');
          return 0;
        }
    
        // Handle graceful shutdown
        const shutdown = async () => {
          ctx.presenter.write('');
          ctx.presenter.write(safeColors.info('→') + ' Stopping watcher...');
          await watcher.stop();
          
          const totalTime = Date.now() - startTime;
          
          // Track command completion
          await emit({
            type: ANALYTICS_EVENTS.WATCH_FINISHED,
            payload: {
              mode,
              verbose,
              changeCount,
              durationMs: totalTime,
              result: 'success',
            },
          });
          
          const summary = keyValue({
            'Changes detected': changeCount,
            'Total time': formatTiming(totalTime),
            'Mode': mode,
          });
          
          const finalOutput = box('Watch Complete', summary);
          ctx.presenter.write(finalOutput);
          
          process.exit(0);
        };
        
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        
        // Keep the process alive
        return new Promise(() => {});
        
      } catch (e: any) {
        const totalTime = Date.now() - startTime;
        
        // Track command failure
        await emit({
          type: ANALYTICS_EVENTS.WATCH_FINISHED,
          payload: {
            mode: (flags.mode as string) ?? 'auto',
            verbose: !!flags.verbose,
            durationMs: totalTime,
            result: 'error',
            error: e?.message ?? 'Watch failed',
          },
        });
        
        if (jsonMode) {
          ctx.presenter.json({ ok: false, error: e?.message });
        } else {
          ctx.presenter.error(e?.message ?? 'Watch failed');
        }
        return 1;
      }
    }
  );
};
