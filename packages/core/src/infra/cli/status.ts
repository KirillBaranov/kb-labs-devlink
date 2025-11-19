import path from 'node:path';
import type { CommandModule } from './types';
import type { z } from 'zod';
import { status } from '../../api';
import {
  box, 
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
import { getDevlinkQuickActionCommands } from '@devlink/application/devlink/legacy/commands';
import { runScope } from '@kb-labs/analytics-sdk-node';
import { ANALYTICS_EVENTS, ANALYTICS_ACTOR } from '@devlink/infra/analytics/events';
import { DevlinkStatusCommandInputSchema } from '@kb-labs/devlink-contracts/schema';
import { parseCommandFlags } from './utils';

type StatusCommandFlags = z.infer<typeof DevlinkStatusCommandInputSchema>;

export const run: CommandModule<StatusCommandFlags>['run'] = async (ctx, _argv, rawFlags) => {
  const jsonMode = !!(rawFlags as StatusCommandFlags | undefined)?.json;
  const flags = parseCommandFlags(DevlinkStatusCommandInputSchema, rawFlags, {
    ctx,
    command: 'devlink status',
    jsonMode,
  });

  if (!flags) {
    return 1;
  }

  const cwd = typeof flags.cwd === 'string' && flags.cwd ? flags.cwd : process.cwd();
  
  const exitCode = await runScope(
    {
      actor: ANALYTICS_ACTOR,
      ctx: { workspace: cwd },
    },
    async (emit) => {
        try {
          // Parse flags with defaults
          const roots = flags.roots ? flags.roots.split(',') : undefined;
          const consumer = flags.consumer;
          const warningLevel = flags.warningLevel as any;
          const verbose = !!flags.verbose;
          const showSources = !!flags.sources;
          const showDiff = !!flags.diff;
          
          // Track command start
          await emit({
            type: ANALYTICS_EVENTS.STATUS_STARTED,
            payload: {
              verbose,
              sources: showSources,
              diff: showDiff,
            },
          });
          
          const result = await status({
            rootDir: cwd,
            roots,
            consumer,
            warningLevel,
          });

      if (jsonMode) {
        ctx.presenter.json(result);
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
              ...Object.entries(result.diff.byConsumer).flatMap(([consumerName, consumerDiff]) => {
                const lines = [`  ${safeColors.bold(consumerName)}:`];
                
                if (consumerDiff.added.length > 0) {
                  lines.push(`    ${safeColors.success('+')} Added (${consumerDiff.added.length}):`);
                  consumerDiff.added.slice(0, 3).forEach(entry => {
                    lines.push(`      ${entry.name}@${entry.to} (${entry.section})`);
                  });
                  if (consumerDiff.added.length > 3) {
                    lines.push(`      ... and ${consumerDiff.added.length - 3} more`);
                  }
                }
                
                if (consumerDiff.removed.length > 0) {
                  lines.push(`    ${safeColors.error('-')} Removed (${consumerDiff.removed.length}):`);
                  consumerDiff.removed.slice(0, 3).forEach(entry => {
                    lines.push(`      ${entry.name}@${entry.from}`);
                  });
                  if (consumerDiff.removed.length > 3) {
                    lines.push(`      ... and ${consumerDiff.removed.length - 3} more`);
                  }
                }
                
                if (consumerDiff.mismatched.length > 0) {
                  lines.push(`    ${safeColors.warning('~')} Mismatched (${consumerDiff.mismatched.length}):`);
                  consumerDiff.mismatched.slice(0, 3).forEach(entry => {
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
              ...result.suggestions.flatMap(suggestion => {
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
        
        const output = box('DevLink Status', sections);
        ctx.presenter.write(output);
        
          if (result.timings) {
            ctx.presenter.write('');
            ctx.presenter.write(safeColors.dim(`Status check: ${formatTiming(result.timings.total)}`));
          }
        }

        // Track command completion
        await emit({
          type: ANALYTICS_EVENTS.STATUS_FINISHED,
          payload: {
            mode: result.context.mode,
            warnings: result.warnings.length,
            consumers: result.lock.consumers,
            deps: result.lock.deps,
            durationMs: result.timings?.total ?? 0,
            result: result.ok ? 'success' : 'failed',
          },
        });

        return result.ok ? 0 : 1;
      } catch (e: any) {
        // Track command failure
        await emit({
          type: ANALYTICS_EVENTS.STATUS_FINISHED,
          payload: {
            result: 'error',
            error: e?.message ?? 'Status failed',
          },
        });
        
        if (jsonMode) {
          ctx.presenter.json({ ok: false, error: e?.message });
        } else {
          ctx.presenter.error(e?.message ?? 'Status failed');
        }
        return 1;
      }
    }
  );

  return exitCode as number | void;
};
