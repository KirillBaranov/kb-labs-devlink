import { defineCommand, type CommandResult } from '@kb-labs/cli-command-kit';
import { join } from 'node:path';
import { scanAndPlan } from '../../api';
import { keyValue, formatTiming, displayArtifactsCompact } from '@kb-labs/shared-cli-ui';
import { discoverArtifacts } from '@devlink/application/devlink/legacy/status';
import { writeJson } from '../filesystem/fs';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';
import { resolveWorkspaceRoot } from '@kb-labs/core-workspace';

type DevlinkPlanFlags = {
  cwd: { type: 'string'; description?: string };
  container: { type: 'boolean'; description?: string; default?: boolean };
  mode: { type: 'string'; description?: string; choices?: readonly string[] };
  roots: { type: 'string'; description?: string };
  strict: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkPlanResult = CommandResult & {
  plan?: any;
  diagnostics?: string[];
  timings?: any;
};

export const run = defineCommand<DevlinkPlanFlags, DevlinkPlanResult>({
  name: 'devlink:plan',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    container: {
      type: 'boolean',
      description: 'Treat current directory as a workspace container and scan child repositories',
      default: false,
    },
    mode: {
      type: 'string',
      description: 'Scan mode (npm, local, auto)',
      choices: ['npm', 'local', 'auto'] as const,
    },
    roots: {
      type: 'string',
      description: 'Comma-separated workspace roots to include',
    },
    strict: {
      type: 'boolean',
      description: 'Fail when workspace dependencies are missing',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output diagnostics in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.PLAN_STARTED,
    finishEvent: ANALYTICS_EVENTS.PLAN_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const requestedCwd = flags.cwd && flags.cwd.length > 0 ? flags.cwd : undefined;
    const workspaceResolution = await resolveWorkspaceRoot({
      cwd: requestedCwd,
      startDir: requestedCwd ?? ctx.workdir,
    });
    const cwd = workspaceResolution.rootDir;
    const mode = flags.mode ?? 'auto';
    const roots = flags.roots ? flags.roots.split(',') : undefined;
    const strict = !!flags.strict;
    const container = !!flags.container;

    ctx.tracker.checkpoint('scan');

    const result = await scanAndPlan({
      rootDir: cwd,
      mode,
      roots,
      strict,
      container,
    });

    const totalTime = ctx.tracker.total();

    if (flags.json) {
      ctx.output.json({
        ok: result.ok,
        plan: result.plan,
        diagnostics: result.diagnostics,
        timings: result.timings,
        totalTime,
      });
    } else {
      if (result.plan) {
        // Save plan to last-plan.json
        const lastPlanPath = join(cwd, '.kb', 'devlink', 'last-plan.json');
        await writeJson(lastPlanPath, result.plan);

        const summary = keyValue({
          'Mode': mode,
          'Actions': result.plan.actions.length,
          'Packages': Object.keys(result.plan.index.packages).length,
          'Diagnostics': result.diagnostics.length,
        });

        const timingInfo = [
          `Discovery: ${formatTiming(result.timings.discovery)}`,
          `Plan: ${formatTiming(result.timings.plan)}`,
          `Total: ${formatTiming(totalTime)}`,
        ];

        // Show artifacts after saving plan
        const artifacts = await discoverArtifacts(cwd);
        const artifactsInfo = displayArtifactsCompact(artifacts, { maxItems: 5 });

        const { ui } = ctx.output;
        const output = ui.box('DevLink Plan', [...summary, '', ...timingInfo, ...artifactsInfo]);
        ctx.output.write(output);

        if (result.diagnostics.length > 0) {
          ctx.output.write('');
          ctx.output.write('Diagnostics:');
          result.diagnostics.forEach(msg =>
            ctx.output.write(`  • ${msg}`)
          );
        }
      } else {
        ctx.output.error(new Error('Failed to create plan'));
        if (result.diagnostics.length > 0) {
          ctx.output.write('');
          ctx.output.write('Diagnostics:');
          result.diagnostics.forEach(msg =>
            ctx.output.write(`  • ${msg}`)
          );
        }
      }
    }

    return {
      ok: result.ok,
      plan: result.plan,
      diagnostics: result.diagnostics,
      timings: result.timings,
    };
  },
});
