import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/analytics/index.ts',
    'src/artifacts/index.ts',
    'src/backup/index.ts',
    'src/filesystem/index.ts',
    'src/logging/index.ts',
    'src/maintenance/index.ts',
    'src/preflight/index.ts',
    'src/process/index.ts',
    'src/state/index.ts',
    'src/time/index.ts',
    'src/vcs/index.ts',
    'src/watch/index.ts',
    'src/workspace/index.ts',
  ],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,  // Disable code splitting
  tsconfig: './tsconfig.json',
  external: [
    '@kb-labs/devlink-contracts',
    '@kb-labs/core-sys',
    '@kb-labs/core-workspace',
    'glob',
    'p-queue',
    'chokidar'
  ]
});
