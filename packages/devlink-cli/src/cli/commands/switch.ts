import { defineCommand, useLoader, TimingTracker, type PluginContextV3, type CommandResult } from '@kb-labs/sdk';
import { discoverMonorepos, buildPackageMapFiltered, buildPlan, applyPlan, createBackup, loadState, saveState, checkGitDirty } from '@kb-labs/devlink-core';
import type { DevlinkMode } from '@kb-labs/devlink-contracts';

interface SwitchFlags {
  mode: DevlinkMode;
  'dry-run'?: boolean;
  repos?: string;
  yes?: boolean;
  json?: boolean;
  ttl?: number;
}

interface SwitchInput {
  argv?: string[];
  flags?: SwitchFlags;
  mode?: DevlinkMode;
  'dry-run'?: boolean;
  repos?: string;
  yes?: boolean;
  json?: boolean;
}

interface SwitchResult {
  mode: DevlinkMode;
  changed: number;
  dryRun: boolean;
  backupId?: string;
}

export default defineCommand<unknown, SwitchInput, SwitchResult>({
  id: 'devlink:switch',
  description: 'Switch cross-repo deps between link: and npm mode',

  handler: {
    async execute(ctx: PluginContextV3, input: SwitchInput): Promise<CommandResult<SwitchResult>> {
      const tracker = new TimingTracker();
      const flags = (input.flags ?? input) as SwitchFlags;
      const mode = flags.mode;
      const dryRun = flags['dry-run'] ?? false;
      const outputJson = flags.json ?? false;
      const scopedRepos = flags.repos ? flags.repos.split(',').map(s => s.trim()) : undefined;
      const ttlMs = (flags.ttl ?? 24) * 60 * 60 * 1000;

      const rootDir = ctx.cwd ?? process.cwd();

      // 1. Discover
      const discoverLoader = useLoader('Discovering monorepos...');
      discoverLoader.start();

      const monorepos = discoverMonorepos(rootDir);
      const packageMap = await buildPackageMapFiltered(monorepos, rootDir, ttlMs);
      discoverLoader.succeed(`Found ${monorepos.length} monorepos, ${Object.keys(packageMap).length} packages`);
      tracker.checkpoint('discovery');

      // 2. Warn if git dirty
      const dirtyFiles = checkGitDirty(rootDir);
      if (dirtyFiles.length > 0) {
        ctx.ui?.warn?.(`Working tree has ${dirtyFiles.length} uncommitted changes`);
      }

      // 3. Build plan
      const plan = buildPlan(mode, packageMap, monorepos, rootDir, { scopedRepos });
      tracker.checkpoint('plan');

      if (plan.items.length === 0) {
        ctx.ui?.info?.('No changes needed — dependencies are already in the requested mode.');
        return { exitCode: 0, result: { mode, changed: 0, dryRun }, meta: { timing: tracker.total() } };
      }

      // 4. Dry-run: show plan and exit
      if (dryRun) {
        const result: SwitchResult = { mode, changed: plan.items.length, dryRun: true };
        if (outputJson) {
          ctx.ui?.json?.({ ...result, items: plan.items });
        } else {
          const byRepo = new Map<string, number>();
          for (const item of plan.items) {
            byRepo.set(item.monorepo, (byRepo.get(item.monorepo) ?? 0) + 1);
          }
          const repoLines = [...byRepo.entries()].map(([repo, count]) => `${repo}: ${count} change(s)`);
          ctx.ui?.success?.(`[dry-run] Would switch ${plan.items.length} dependencies to ${mode} mode`, {
            title: 'DevLink — Dry Run',
            sections: [
              { header: 'Changes by repo', items: repoLines },
              { header: 'Note', items: ['No files were modified. Remove --dry-run to apply.'] },
            ],
            timing: tracker.total(),
          });
        }
        return { exitCode: 0, result, meta: { timing: tracker.total() } };
      }

      // 5. Create backup
      const currentState = loadState(rootDir);
      // Detect actual current mode from plan items (reliable even before first switch)
      const detectedMode: DevlinkMode = plan.items[0]?.from.startsWith('link:') ? 'local' : 'npm';
      const modeAtBackup = currentState.currentMode ?? detectedMode;
      const uniqueFiles = [...new Set(plan.items.map(i => i.packageJsonPath))];
      const backup = createBackup(rootDir, uniqueFiles, `pre-switch to ${mode}`, modeAtBackup);
      tracker.checkpoint('backup');

      // 6. Apply
      const applyLoader = useLoader(`Switching ${plan.items.length} dependencies to ${mode} mode...`);
      applyLoader.start();

      const applyResult = await applyPlan(plan, { dryRun: false });
      applyLoader.succeed(`Applied ${applyResult.applied} change(s)`);
      tracker.checkpoint('apply');

      // 7. Save state
      saveState(rootDir, {
        currentMode: mode,
        lastApplied: new Date().toISOString(),
        frozenAt: currentState.frozenAt,
      });

      // 8. Output
      const result: SwitchResult = {
        mode,
        changed: applyResult.applied,
        dryRun: false,
        backupId: backup.id,
      };

      if (outputJson) {
        ctx.ui?.json?.(result);
      } else {
        const sections = [
          {
            header: 'Summary',
            items: [
              `Mode: ${mode}`,
              `Changed: ${applyResult.applied} dependencies`,
              `Backup: ${backup.id}`,
            ],
          },
          ...(applyResult.errors.length > 0
            ? [{ header: 'Errors', items: applyResult.errors.map(e => `${e.file}: ${e.error}`) }]
            : []),
          {
            header: 'Next step',
            items: ['Run pnpm install to apply changes'],
          },
        ];
        ctx.ui?.success?.(`Switched to ${mode} mode`, {
          title: 'DevLink — Switch',
          sections,
          timing: tracker.total(),
        });
      }

      return { exitCode: 0, result, meta: { timing: tracker.total() } };
    },
  },
});
