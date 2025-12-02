import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: true,
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
