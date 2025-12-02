import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,  // Disable DTS temporarily
  sourcemap: true,
  clean: true,
  tsconfig: './tsconfig.json',
  external: [
    '@kb-labs/devlink-core',
    '@kb-labs/devlink-adapters',
    '@kb-labs/devlink-contracts',
    '@kb-labs/shared-command-kit',
    '@kb-labs/shared-cli-ui',
    '@kb-labs/core-workspace'
  ]
});
