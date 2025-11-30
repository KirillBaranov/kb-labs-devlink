import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { DevLinkWatcher } from '../rest';
import { keyValue, formatTiming, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
import type { WatchMode } from '../core/operations/watch';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../infrastructure/analytics/events';

type DevlinkWatchFlags = {
  cwd: { type: 'string'; description?: string };
  mode: { type: 'string'; description?: string; choices?: readonly string[] };
  verbose: { type: 'boolean'; description?: string; default?: boolean };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean };
  dryRun: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkWatchResult = CommandResult & {
  changeCount?: number;
};

export const run = defineCommand<DevlinkWatchFlags, DevlinkWatchResult>({
  name: 'devlink:watch',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    mode: {
      type: 'string',
      description: 'Watch mode',
      choices: ['npm', 'local', 'auto'] as const,
    },
    verbose: {
      type: 'boolean',
      description: 'Enable verbose output',
      default: false,
    },
    'dry-run': {
      type: 'boolean',
      description: 'Preview changes without executing',
      default: false,
    },
    dryRun: {
      type: 'boolean',
      description: 'Preview changes without executing',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output diagnostics in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.WATCH_STARTED,
    finishEvent: ANALYTICS_EVENTS.WATCH_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : ctx.workdir;
    const requestedMode = (flags.mode as 'npm' | 'local' | 'auto') ?? 'auto';
    const mode: WatchMode = requestedMode === 'npm' ? 'auto' : requestedMode;
    const verbose = !!flags.verbose;
    const dryRun = !!(flags['dry-run'] || flags.dryRun);
    const jsonMode = !!flags.json;

    if (jsonMode) {
      ctx.output.json({
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
      return { ok: true };
    }

    // Show initial status
    const statusInfo = keyValue({
      'Mode': mode,
      'Verbose': verbose ? 'enabled' : 'disabled',
      'Watching': 'Starting...',
    });

    const { ui } = ctx.output;
    const output = ui.box('DevLink Watch', statusInfo);
    ctx.output.write(output);
    ctx.output.write('');

    // Create watcher
    const watcher = new DevLinkWatcher({
      rootDir: cwd,
      mode,
      dryRun,
    });

    let changeCount = 0;

    // Set up event handlers
    watcher.on('change', (event) => {
      changeCount++;
      const timestamp = new Date().toLocaleTimeString();

      ctx.output.write(`${safeColors.dim(`[${timestamp}]`)} ${safeColors.info('→')} Change detected: ${event.file}`);

      if (event.package) {
        ctx.output.write(`  ${safeColors.dim('•')} Package: ${event.package}`);
      }

      if (event.dependents && event.dependents.length > 0) {
        ctx.output.write(`  ${safeColors.dim('•')} Dependents: ${event.dependents.join(', ')}`);
      }

      ctx.output.write('');
    });

    watcher.on('rebuild', (event) => {
      const timestamp = new Date().toLocaleTimeString();
      ctx.output.write(`${safeColors.dim(`[${timestamp}]`)} ${safeColors.info('→')} Rebuilding ${event.package}...`);
    });

    watcher.on('rebuild-complete', (event) => {
      const timestamp = new Date().toLocaleTimeString();
      const duration = formatTiming(event.duration);
      ctx.output.write(`${safeColors.dim(`[${timestamp}]`)} ${safeSymbols.success} Rebuild complete (${duration})`);
      ctx.output.write('');
    });

    watcher.on('error', (error) => {
      const timestamp = new Date().toLocaleTimeString();
      ctx.output.write(`${safeColors.dim(`[${timestamp}]`)} ${safeSymbols.error} Error: ${error.message}`);
      ctx.output.write('');
    });

    watcher.on('ready', () => {
      const timestamp = new Date().toLocaleTimeString();
      ctx.output.write(`${safeColors.dim(`[${timestamp}]`)} ${safeSymbols.success} Watcher ready`);
      ctx.output.write('');
      ctx.output.write(safeColors.dim('Press Ctrl+C to stop'));
      ctx.output.write('');
    });

    // Start watching
    await watcher.start();

    // For dry-run, exit immediately after showing results
    if (dryRun) {
      ctx.output.write('');
      ctx.output.write(safeColors.success('✓') + ' Dry-run complete');
      return { ok: true, changeCount };
    }

    // Handle graceful shutdown
    const shutdown = async () => {
      ctx.output.write('');
      ctx.output.write(safeColors.info('→') + ' Stopping watcher...');
      await watcher.stop();

      const totalTime = ctx.tracker.total();

      const summary = keyValue({
        'Changes detected': changeCount,
        'Total time': formatTiming(totalTime),
        'Mode': mode,
      });

      const finalOutput = ui.box('Watch Complete', summary);
      ctx.output.write(finalOutput);

      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Keep the process alive
    return new Promise(() => {});
  },
});
