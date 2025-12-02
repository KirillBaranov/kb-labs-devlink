import { defineCommand, type CommandResult } from '@kb-labs/shared-command-kit';
import { scanAndPlan, apply } from '@kb-labs/devlink-core';
import { keyValue, formatTiming, safeColors } from '@kb-labs/shared-cli-ui';
import { Loader } from '@kb-labs/shared-cli-ui';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@kb-labs/devlink-adapters/analytics';

type DevlinkSwitchFlags = {
  cwd: { type: 'string'; description?: string };
  mode: { type: 'string'; description?: string; choices?: readonly string[] };
  yes: { type: 'boolean'; description?: string; default?: boolean };
  'dry-run': { type: 'boolean'; description?: string; default?: boolean };
  dryRun: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkSwitchResult = CommandResult & {
  switched?: number;
  skipped?: number;
  errors?: number;
  needsInstall?: boolean;
  diagnostics?: string[];
  timings?: any;
};

export const run = defineCommand<DevlinkSwitchFlags, DevlinkSwitchResult>({
  name: 'devlink:switch',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    mode: {
      type: 'string',
      description: 'Switch mode',
      choices: ['npm', 'local', 'auto'] as const,
    },
    yes: {
      type: 'boolean',
      description: 'Skip confirmation prompts',
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
    startEvent: ANALYTICS_EVENTS.SWITCH_STARTED,
    finishEvent: ANALYTICS_EVENTS.SWITCH_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : ctx.workdir;
    const mode = flags.mode as 'npm' | 'local' | 'auto';
    const yes = !!flags.yes;
    const dryRun = !!(flags['dry-run'] || flags.dryRun);
    const jsonMode = !!flags.json;

    if (!mode) {
      ctx.output.error(new Error('Mode is required. Use --mode npm|local|auto'));
      return { ok: false };
    }

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
        ctx.output.json({ ok: false, error: 'Scan failed', diagnostics: scanResult.diagnostics });
      } else {
        ctx.output.error(new Error('Failed to scan workspace'));
        scanResult.diagnostics.forEach(msg => ctx.output.write(`  ${safeColors.dim('•')} ${msg}`));
      }
      return { ok: false, diagnostics: scanResult.diagnostics };
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
      ctx.output.write('');
      ctx.output.write(safeColors.info('→') + ' Starting apply operation...');
      ctx.output.write(safeColors.dim('  This may take a while due to yalc operations'));
      ctx.output.write('');

      const applyLoader = new Loader({
        text: 'Applying changes...',
        spinner: true,
        jsonMode: false
      });
      applyLoader.start();

      const cleanup = () => {
        applyLoader.stop();
      };

      applyPromise.finally(cleanup);
      timeoutPromise.finally(cleanup);
    }

    const applyResult = await Promise.race([applyPromise, timeoutPromise]) as any;

    const totalTime = ctx.tracker.total();

    if (jsonMode) {
      ctx.output.json({
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

        const { ui } = ctx.output;
        const output = ui.box(`Switch Mode: ${mode}`, summary);
        ctx.output.write(output);

        if (applyResult.needsInstall) {
          ctx.output.write('');
          ctx.output.write(safeColors.warning('⚠️  Run: pnpm install'));
        }

        if (applyResult.diagnostics && applyResult.diagnostics.length > 0) {
          ctx.output.write('');
          ctx.output.write(safeColors.warning('Diagnostics:'));
          applyResult.diagnostics.forEach((msg: string) =>
            ctx.output.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      } else {
        loader.fail('Switch failed');
        ctx.output.error(new Error('Failed to switch mode'));
        if (applyResult.errors && applyResult.errors.length > 0) {
          ctx.output.write(safeColors.error('Errors:'));
          applyResult.errors.forEach((error: any) =>
            ctx.output.write(`  ${safeColors.dim('•')} ${error}`)
          );
        }
        if (applyResult.diagnostics) {
          applyResult.diagnostics.forEach((msg: string) =>
            ctx.output.write(`  ${safeColors.dim('•')} ${msg}`)
          );
        }
      }
    }

    return {
      ok: applyResult.ok,
      switched: applyResult.executed.length,
      skipped: applyResult.skipped.length,
      errors: applyResult.errors.length,
      needsInstall: applyResult.needsInstall,
      diagnostics: applyResult.diagnostics,
      timings: {
        discovery: scanResult.timings?.discovery || 0,
        plan: scanResult.timings?.plan || 0,
        apply: totalTime - (scanResult.timings?.discovery || 0) - (scanResult.timings?.plan || 0),
        total: totalTime,
      },
    };
  },
});
