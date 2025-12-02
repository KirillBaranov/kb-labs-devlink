import { defineConfig } from 'tsup';
import nodePreset from '@kb-labs/devkit/tsup/node.js';

export default defineConfig({
  ...nodePreset,
  dts: false,  // Disable DTS temporarily due to type errors
  tsconfig: "tsconfig.build.json",
  entry: ['src/index.ts'],
});
