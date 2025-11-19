import { defineConfig } from "vitest/config";
import nodePreset from "@kb-labs/devkit/vitest/node.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const rootDir = fileURLToPath(new URL("../../", import.meta.url));
const coreSrc = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  ...nodePreset,
  resolve: {
    ...nodePreset.resolve,
    alias: {
      ...nodePreset.resolve?.alias,
      "@devlink/shared": join(coreSrc, "shared"),
      "@devlink/shared/": join(coreSrc, "shared"),
      "@devlink/application": join(coreSrc, "application"),
      "@devlink/application/": join(coreSrc, "application"),
      "@devlink/domain": join(coreSrc, "domain"),
      "@devlink/domain/": join(coreSrc, "domain"),
      "@devlink/infra": join(coreSrc, "infra"),
      "@devlink/infra/": join(coreSrc, "infra"),
    },
  },
  test: {
    ...nodePreset.test,
    globals: false,
    coverage: {
      ...(nodePreset.test?.coverage || {}),
      all: true,
      reportsDirectory: "./coverage",
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/__tests__/**",
        "**/*.d.ts",
        "**/types.ts",
        "**/types/**",
      ],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
