import { defineCommand, useLoader, TimingTracker, type PluginContextV3, type CommandResult } from '@kb-labs/sdk';
import { discoverMonorepos, buildPackageMapFiltered, analyzePackageDeps, loadState } from '@kb-labs/devlink-core';
import type { DevlinkStatus } from '@kb-labs/devlink-contracts';

interface StatusFlags {
  json?: boolean;
  verbose?: boolean;
}

interface StatusInput {
  argv?: string[];
  flags?: StatusFlags;
  json?: boolean;
  verbose?: boolean;
}

export default defineCommand<unknown, StatusInput, DevlinkStatus>({
  id: 'devlink:status',
  description: 'Show current state of cross-repo dependencies',

  handler: {
    async execute(ctx: PluginContextV3, input: StatusInput): Promise<CommandResult<DevlinkStatus>> {
      const tracker = new TimingTracker();
      const flags = (input.flags ?? input) as StatusFlags;
      const outputJson = flags.json ?? false;

      const rootDir = ctx.cwd ?? process.cwd();

      const loader = useLoader('Analyzing dependencies...');
      loader.start();

      const state = loadState(rootDir);
      const monorepos = discoverMonorepos(rootDir);
      const packageMap = await buildPackageMapFiltered(monorepos, rootDir);

      let totalLink = 0;
      let totalNpm = 0;
      let totalWorkspace = 0;
      const discrepancies: DevlinkStatus['discrepancies'] = [];

      for (const monorepo of monorepos) {
        for (const pkgPath of monorepo.packagePaths) {
          const counts = analyzePackageDeps(pkgPath, packageMap);
          totalLink += counts.linkCount;
          totalNpm += counts.npmCount;
          totalWorkspace += counts.workspaceCount;
        }
      }

      // Detect discrepancies: mixed modes
      const detectedMode = totalLink > 0 && totalNpm > 0 ? null
        : totalLink > 0 ? 'local' as const
        : totalNpm > 0 ? 'npm' as const
        : null;

      loader.succeed('Analysis complete');
      tracker.checkpoint('analysis');

      const status: DevlinkStatus = {
        currentMode: state.currentMode,
        lastApplied: state.lastApplied,
        linkCount: totalLink,
        npmCount: totalNpm,
        workspaceCount: totalWorkspace,
        discrepancies,
      };

      if (outputJson) {
        ctx.ui?.json?.(status);
      } else {
        const modeStr = state.currentMode ? state.currentMode : detectedMode ?? 'mixed/unknown';
        const sections = [
          {
            header: 'Current mode',
            items: [
              `Mode: ${modeStr}`,
              `Last applied: ${state.lastApplied ?? 'never'}`,
            ],
          },
          {
            header: 'Dependency counts',
            items: [
              `link: (local)   : ${totalLink}`,
              `npm (^version)  : ${totalNpm}`,
              `workspace:*     : ${totalWorkspace}`,
            ],
          },
          ...(detectedMode !== state.currentMode && state.currentMode !== null
            ? [{ header: '⚠ Warning', items: ['Detected mode differs from saved state — run switch to fix'] }]
            : []),
        ];

        ctx.ui?.success?.('Dependency status', {
          title: 'DevLink — Status',
          sections,
          timing: tracker.total(),
        });
      }

      return { exitCode: 0, result: status, meta: { timing: tracker.total() } };
    },
  },
});
