import { defineConfig } from 'tsup';
import nodePreset from '@kb-labs/devkit/tsup/node.js';

export default defineConfig({
  ...nodePreset,
  tsconfig: "tsconfig.build.json", // Use build-specific tsconfig without paths
  entry: [
    'src/index.ts',
    'src/manifest.v2.ts',
    'src/cli/apply.ts',
    'src/cli/backups.ts',
    'src/cli/clean.ts',
    'src/cli/freeze.ts',
    'src/cli/plan.ts',
    'src/cli/status.ts',
    'src/cli/switch.ts',
    'src/cli/types.ts',
    'src/cli/undo.ts',
    'src/cli/update.ts',
    'src/cli/watch.ts',
    'src/rest/handlers/plan-handler.ts',
    'src/rest/schemas/plan-schema.ts'
  ],
});
