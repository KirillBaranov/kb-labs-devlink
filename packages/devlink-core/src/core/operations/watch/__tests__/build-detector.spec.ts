import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { detectBuildCommand, detectWatchPaths, shouldIgnorePath } from "../build-detector";
import type { PackageRef } from "../../types";

describe("build-detector", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "devlink-test-"));
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  describe("detectBuildCommand", () => {
    it("should use devlink.watch.build override from package.json", async () => {
      const pkgDir = join(tempDir, "pkg");
      await fsp.mkdir(pkgDir, { recursive: true });
      
      await fsp.writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "test-pkg",
          devlink: {
            watch: {
              build: "custom-build-command",
            },
          },
        })
      );

      const pkgRef: PackageRef = {
        name: "test-pkg",
        version: "1.0.0",
        dir: pkgDir,
        manifest: {},
        pkg: { name: "test-pkg", version: "1.0.0" },
      };

      const command = await detectBuildCommand(pkgRef);
      expect(command).toBe("custom-build-command");
    });

    it("should use pnpm run build when scripts.build exists (ignoring tsconfig references)", async () => {
      const pkgDir = join(tempDir, "pkg");
      await fsp.mkdir(pkgDir, { recursive: true });
      
      await fsp.writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "test-pkg",
          scripts: { build: "tsup" },
        })
      );

      await fsp.writeFile(
        join(pkgDir, "tsconfig.json"),
        JSON.stringify({
          references: [{ path: "../other" }],
        })
      );

      const pkgRef: PackageRef = {
        name: "test-pkg",
        version: "1.0.0",
        dir: pkgDir,
        manifest: {},
        pkg: { name: "test-pkg", version: "1.0.0" },
      };

      const command = await detectBuildCommand(pkgRef);
      expect(command).toBe("pnpm run build");
    });

    it("should use pnpm run build when scripts.build exists", async () => {
      const pkgDir = join(tempDir, "pkg");
      await fsp.mkdir(pkgDir, { recursive: true });
      
      await fsp.writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "test-pkg",
          scripts: { build: "tsup" },
        })
      );

      const pkgRef: PackageRef = {
        name: "test-pkg",
        version: "1.0.0",
        dir: pkgDir,
        manifest: {},
        pkg: { name: "test-pkg", version: "1.0.0" },
      };

      const command = await detectBuildCommand(pkgRef);
      expect(command).toBe("pnpm run build");
    });

    it("should return null when no build script found", async () => {
      const pkgDir = join(tempDir, "pkg");
      await fsp.mkdir(pkgDir, { recursive: true });

      const pkgRef: PackageRef = {
        name: "test-pkg",
        version: "1.0.0",
        dir: pkgDir,
        manifest: {},
        pkg: { name: "test-pkg", version: "1.0.0" },
      };

      const command = await detectBuildCommand(pkgRef);
      expect(command).toBe(null);
    });

    it("should handle array override in devlink.watch.build", async () => {
      const pkgDir = join(tempDir, "pkg");
      await fsp.mkdir(pkgDir, { recursive: true });
      
      await fsp.writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({
          name: "test-pkg",
          devlink: {
            watch: {
              build: ["cmd1", "cmd2", "cmd3"],
            },
          },
        })
      );

      const pkgRef: PackageRef = {
        name: "test-pkg",
        version: "1.0.0",
        dir: pkgDir,
        manifest: {},
        pkg: { name: "test-pkg", version: "1.0.0" },
      };

      const command = await detectBuildCommand(pkgRef);
      expect(command).toBe("cmd1 && cmd2 && cmd3");
    });
  });

  describe("detectWatchPaths", () => {
    it("should return standard watch paths", () => {
      const pkgRef: PackageRef = {
        name: "test-pkg",
        version: "1.0.0",
        dir: "/fake/dir",
        manifest: {},
        pkg: { name: "test-pkg", version: "1.0.0" },
      };

      const paths = detectWatchPaths(pkgRef);
      
      expect(paths).toContain("package.json");
      expect(paths).toContain("src/**/*");
      expect(paths).toContain("tsconfig*.json");
      expect(paths).toContain("dist/**/*");
    });
  });

  describe("shouldIgnorePath", () => {
    it("should ignore node_modules", () => {
      expect(shouldIgnorePath("node_modules/some-dep")).toBe(true);
      expect(shouldIgnorePath("packages/app/node_modules/dep")).toBe(true);
    });

    it("should ignore test files", () => {
      expect(shouldIgnorePath("src/utils.test.ts")).toBe(true);
      expect(shouldIgnorePath("src/utils.spec.ts")).toBe(true);
      expect(shouldIgnorePath("__tests__/utils.ts")).toBe(true);
    });

    it("should ignore .kb/devlink/backups", () => {
      expect(shouldIgnorePath(".kb/devlink/backups/2025-01-01")).toBe(true);
    });

    it("should not ignore source files", () => {
      expect(shouldIgnorePath("src/index.ts")).toBe(false);
      expect(shouldIgnorePath("lib/utils.js")).toBe(false);
    });
  });
});

