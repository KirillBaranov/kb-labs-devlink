import { defineCommand, type CommandResult } from '@kb-labs/shared-command-kit';
import { status } from '../rest';
import {
  keyValue,
  formatTiming,
  formatRelativeTime,
  safeSymbols,
  safeColors,
  generateQuickActions,
  createCommandRegistry,
  displayArtifactsCompact
} from '@kb-labs/shared-cli-ui';
import { parseBackupTimestamp } from '../time/timestamp';
import { getDevlinkQuickActionCommands } from '../core/operations/commands';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '../infrastructure/analytics/events';

type DevlinkStatusFlags = {
  cwd: { type: 'string'; description?: string };
  roots: { type: 'string'; description?: string };
  consumer: { type: 'string'; description?: string };
  warningLevel: { type: 'string'; description?: string; choices?: readonly string[] };
  verbose: { type: 'boolean'; description?: string; default?: boolean };
  sources: { type: 'boolean'; description?: string; default?: boolean };
  diff: { type: 'boolean'; description?: string; default?: boolean };
  json: { type: 'boolean'; description?: string; default?: boolean };
};

type DevlinkStatusResult = CommandResult & {
  context?: any;
  lock?: any;
  warnings?: any[];
  diff?: any;
  suggestions?: any[];
  artifacts?: any[];
  timings?: any;
};

export const run = defineCommand<DevlinkStatusFlags, DevlinkStatusResult>({
  name: 'devlink:status',
  flags: {
    cwd: {
      type: 'string',
      description: 'Working directory',
    },
    roots: {
      type: 'string',
      description: 'Comma-separated workspace roots to include',
    },
    consumer: {
      type: 'string',
      description: 'Filter by consumer package',
    },
    warningLevel: {
      type: 'string',
      description: 'Warning level filter',
      choices: ['error', 'warn', 'info'] as const,
    },
    verbose: {
      type: 'boolean',
      description: 'Show detailed information',
      default: false,
    },
    sources: {
      type: 'boolean',
      description: 'Show dependency sources breakdown',
      default: false,
    },
    diff: {
      type: 'boolean',
      description: 'Show changes diff',
      default: false,
    },
    json: {
      type: 'boolean',
      description: 'Output in JSON format',
      default: false,
    },
  },
  analytics: {
    startEvent: ANALYTICS_EVENTS.STATUS_STARTED,
    finishEvent: ANALYTICS_EVENTS.STATUS_FINISHED,
    actor: ANALYTICS_ACTOR,
    includeFlags: true,
  },
  async handler(ctx, argv, flags) {
    const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : ctx.workdir;

    // Parse flags with defaults
    const roots = flags.roots ? flags.roots.split(',') : undefined;
    const consumer = flags.consumer;
    const warningLevel = flags.warningLevel as any;
    const verbose = !!flags.verbose;
    const showSources = !!flags.sources;
    const showDiff = !!flags.diff;

    const result = await status({
      rootDir: cwd,
      roots,
      consumer,
      warningLevel,
    });

    if (flags.json) {
      ctx.output.json(result);
    } else {
      // Build status summary
      const workspaceInfo = keyValue({
        'Workspace': cwd.split('/').pop() || cwd,
        'Mode': result.context.mode,
        'Last op': result.context.lastOperation === 'none' ? 'none' :
          result.context.lastOperationTs
            ? (() => {
                const parsed = parseBackupTimestamp(result.context.lastOperationTs);
                return parsed.date
                  ? `${result.context.lastOperation} (${formatRelativeTime(parsed.date)})`
                  : `${result.context.lastOperation} (invalid time)`;
              })()
            : `${result.context.lastOperation} (unknown time)`,
      });

      const lockInfo = keyValue({
        'Consumers': result.lock.consumers,
        'Dependencies': result.lock.deps,
        'Generated': result.lock.generatedAt ?
          formatRelativeTime(result.lock.generatedAt) : 'never',
      });

      // Add dependency sources breakdown (only if --sources flag or verbose)
      const sourcesInfo = (showSources || verbose) && result.lock.sources && Object.keys(result.lock.sources).length > 0
        ? keyValue({
            'Workspace': result.lock.sources.workspace || 0,
            'Link': result.lock.sources.link || 0,
            'NPM': result.lock.sources.npm || 0,
            'GitHub': result.lock.sources.github || 0,
          })
        : [];

      // Enhanced health info with detailed warnings
      const healthInfo = result.warnings.length === 0
        ? [`${safeSymbols.success} No warnings`]
        : result.warnings.map(w => {
            const icon = w.severity === 'error' ? safeSymbols.error :
                        w.severity === 'warn' ? safeSymbols.warning : safeSymbols.info;
            const examples = w.examples && w.examples.length > 0
              ? ` (${w.examples.slice(0, 2).join(', ')}${w.examples.length > 2 ? '...' : ''})`
              : '';
            return `${icon} ${w.message}${examples}`;
          });

      // Add diff summary if there are changes (only if --diff flag or verbose)
      const diffInfo = (showDiff || verbose) && (result.diff.summary.mismatched > 0 || result.diff.summary.added > 0 || result.diff.summary.removed > 0)
        ? [
            '',
            safeColors.bold('Changes:'),
            ...keyValue({
              'Added': result.diff.summary.added,
              'Removed': result.diff.summary.removed,
              'Mismatched': result.diff.summary.mismatched,
            })
          ]
        : [];

      // Add detailed dependency information in verbose mode
      const detailedChangesInfo = verbose && result.diff.byConsumer && Object.keys(result.diff.byConsumer).length > 0
        ? [
            '',
            safeColors.bold('Detailed Changes:'),
            ...Object.entries(result.diff.byConsumer).flatMap(([consumerName, consumerDiff]: [string, any]) => {
              const lines = [`  ${safeColors.bold(consumerName)}:`];

              if (consumerDiff.added.length > 0) {
                lines.push(`    ${safeColors.success('+')} Added (${consumerDiff.added.length}):`);
                consumerDiff.added.slice(0, 3).forEach((entry: any) => {
                  lines.push(`      ${entry.name}@${entry.to} (${entry.section})`);
                });
                if (consumerDiff.added.length > 3) {
                  lines.push(`      ... and ${consumerDiff.added.length - 3} more`);
                }
              }

              if (consumerDiff.removed.length > 0) {
                lines.push(`    ${safeColors.error('-')} Removed (${consumerDiff.removed.length}):`);
                consumerDiff.removed.slice(0, 3).forEach((entry: any) => {
                  lines.push(`      ${entry.name}@${entry.from}`);
                });
                if (consumerDiff.removed.length > 3) {
                  lines.push(`      ... and ${consumerDiff.removed.length - 3} more`);
                }
              }

              if (consumerDiff.mismatched.length > 0) {
                lines.push(`    ${safeColors.warning('~')} Mismatched (${consumerDiff.mismatched.length}):`);
                consumerDiff.mismatched.slice(0, 3).forEach((entry: any) => {
                  lines.push(`      ${entry.name}: ${entry.lock} → ${entry.manifest} (${entry.section})`);
                });
                if (consumerDiff.mismatched.length > 3) {
                  lines.push(`      ... and ${consumerDiff.mismatched.length - 3} more`);
                }
              }

              return lines;
            })
          ]
        : [];

      // Add suggestions
      const suggestionsInfo = result.suggestions.length > 0
        ? [
            '',
            safeColors.bold('Suggestions:'),
            ...result.suggestions.flatMap((suggestion: any) => {
              const impact = suggestion.impact === 'disruptive' ? safeColors.warning('⚠') : safeColors.success('✓');
              const command = safeColors.dim(`kb ${suggestion.command} ${suggestion.args.join(' ')}`);
              return [
                `  ${impact} ${suggestion.description}`,
                `    ${safeColors.dim('→')} ${command}`
              ];
            })
          ]
        : [];

      // Generate quick actions using shared utilities
      const devlinkCommands = getDevlinkQuickActionCommands();
      const registry = createCommandRegistry(devlinkCommands);
      const quickActions = generateQuickActions(result.warnings.length > 0, registry, 'devlink');

      const quickActionsInfo = quickActions.length > 0
        ? [
            '',
            safeColors.bold('Quick Actions:'),
            ...quickActions.map((action, index) =>
              `  ${safeColors.dim(String(index + 1))} ${safeColors.bold(action.command)} - ${action.description}`
            )
          ]
        : [];

      // Add artifacts information using shared function
      const artifactsInfo = result.artifacts && result.artifacts.length > 0
        ? displayArtifactsCompact(result.artifacts, { maxItems: 5 })
        : [];

      const sections = [
        safeColors.bold('Workspace:'),
        ...workspaceInfo,
        '',
        safeColors.bold('Lock File:'),
        ...lockInfo,
        ...(sourcesInfo.length > 0 ? ['', safeColors.bold('Sources:'), ...sourcesInfo] : []),
        ...diffInfo,
        ...artifactsInfo,
        '',
        safeColors.bold('Health:'),
        ...healthInfo,
        ...detailedChangesInfo,
        ...suggestionsInfo,
        ...quickActionsInfo,
      ];

      const { ui } = ctx.output;
      const output = ui.box('DevLink Status', sections);
      ctx.output.write(output);

      if (result.timings) {
        ctx.output.write('');
        ctx.output.write(safeColors.dim(`Status check: ${formatTiming(result.timings.total)}`));
      }
    }

    return {
      ok: result.ok,
      context: result.context,
      lock: result.lock,
      warnings: result.warnings,
      diff: result.diff,
      suggestions: result.suggestions,
      artifacts: result.artifacts,
      timings: result.timings,
    };
  },
});
