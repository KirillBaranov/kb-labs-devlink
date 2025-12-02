import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/manifest.v2.ts',
    'src/commands/apply.ts',
    'src/commands/backups.ts',
    'src/commands/clean.ts',
    'src/commands/freeze.ts',
    'src/commands/plan.ts',
    'src/commands/status.ts',
    'src/commands/switch.ts',
    'src/commands/undo.ts',
    'src/commands/update.ts',
    'src/commands/watch.ts',
  ],
  format: ['esm'],
  dts: false,  // Disable DTS temporarily
  sourcemap: true,
  clean: true,
  splitting: false,  // Disable code splitting for manifest resolution
  tsconfig: './tsconfig.json',
  external: [
    '@kb-labs/devlink-core',
    '@kb-labs/devlink-adapters',
    '@kb-labs/devlink-contracts',
    '@kb-labs/plugin-manifest',
    '@kb-labs/shared-command-kit',
    '@kb-labs/shared-cli-ui',
    '@kb-labs/core-workspace'
  ]
});
