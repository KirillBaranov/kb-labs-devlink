import { defineConfig } from 'vitest/config';
import nodePreset from '@kb-labs/devkit/vitest/node.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const rootDir = fileURLToPath(new URL('./', import.meta.url));
const coreSrc = join(rootDir, 'packages/core/src');

export default defineConfig({
  ...nodePreset,
  resolve: {
    ...nodePreset.resolve,
    alias: {
      ...nodePreset.resolve?.alias,
      '@devlink/shared': join(coreSrc, 'shared'),
      '@devlink/shared/': join(coreSrc, 'shared'),
      '@devlink/application': join(coreSrc, 'application'),
      '@devlink/application/': join(coreSrc, 'application'),
      '@devlink/domain': join(coreSrc, 'domain'),
      '@devlink/domain/': join(coreSrc, 'domain'),
      '@devlink/infra': join(coreSrc, 'infra'),
      '@devlink/infra/': join(coreSrc, 'infra'),
    },
  },
  test: {
    ...nodePreset.test,
  },
});
