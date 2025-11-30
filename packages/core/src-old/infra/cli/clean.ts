import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { clean } from '../maintenance/clean';
import { keyValue, formatTiming, safeSymbols, safeColors } from '@kb-labs/shared-cli-ui';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';

type DevlinkCleanFlags = {
  cwd: { type: 'string'; description?: string };
  hard: { type: 'boolean'; description?: string; default?: boolean };
  deep: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkCleanResult = CommandResult & {
  removed?: string[];
  hard?: boolean;
  deep?: boolean;
};

export const run = defineCommand<DevlinkCleanFlags, DevlinkCleanResult>({
  name: 'devlink:clean',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    hard: {
      type: 'boolean',
      description: 'Hard clean (remove lock files)',
      default: false,
    },
    deep: {
      type: 'boolean',
      description: 'Deep clean (clean global yalc store)',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output diagnostics in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.CLEAN_STARTED,
    finishEvent: ANALYTICS_EVENTS.CLEAN_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : ctx.workdir;
    const hard = !!flags.hard;
    const deep = !!flags.deep;
    const jsonMode = !!flags.json;

    ctx.tracker.checkpoint('clean');

    const result = await clean(cwd, { hard, deep });

    const totalTime = ctx.tracker.total();

    if (jsonMode) {
      ctx.output.json({
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

      const { ui } = ctx.output;
      const output = ui.box('DevLink Clean', [...summary, '', `Time: ${formatTiming(totalTime)}`]);
      ctx.output.write(output);

      if (result.removed.length > 0) {
        ctx.output.write('');
        ctx.output.write(safeColors.info('Removed files:'));
        result.removed.forEach(file =>
          ctx.output.write(`  ${safeSymbols.success} ${file}`)
        );
      } else {
        ctx.output.write('');
        ctx.output.write(`${safeSymbols.info} No files to clean`);
      }

      if (hard) {
        ctx.output.write('');
        ctx.output.write(safeColors.warning('⚠️  Hard mode: lock file removed'));
      }

      if (deep) {
        ctx.output.write('');
        ctx.output.write(safeColors.warning('⚠️  Deep mode: global yalc store cleaned'));
      }
    }

    return {
      ok: true,
      removed: result.removed,
      hard,
      deep,
    };
  },
});
