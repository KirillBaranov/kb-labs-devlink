import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { status } from "../status";
import { writeJson, exists } from "../../utils/fs";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import path from "node:path";

describe("status auto-scan", () => {
  const testDir = join(__dirname, "__test-status-autoscan__");
  const stateJsonPath = join(testDir, ".kb/devlink/state.json");
  const lastPlanPath = join(testDir, ".kb/devlink/last-plan.json");

  beforeEach(async () => {
    // Create test directory structure
    await fsp.mkdir(join(testDir, "packages/pkg-a"), { recursive: true });
    await fsp.mkdir(join(testDir, "packages/pkg-b"), { recursive: true });
    
    // Create package.json files
    await writeJson(join(testDir, "packages/pkg-a/package.json"), {
      name: "pkg-a",
      version: "1.0.0",
      dependencies: { "pkg-b": "workspace:*" },
    });
    
    await writeJson(join(testDir, "packages/pkg-b/package.json"), {
      name: "pkg-b",
      version: "2.0.0",
    });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fsp.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should run auto-scan when state.json missing", async () => {
    // Ensure no state.json
    expect(await exists(stateJsonPath)).toBe(false);

    // Run status
    const result = await status({ rootDir: testDir });

    // Should have scanned and found packages
    expect(result.packages).toBeGreaterThan(0);
    
    // Should have created state.json
    expect(await exists(stateJsonPath)).toBe(true);
  });

  it("should use roots from last-plan.json for auto-scan", async () => {
    // Create last-plan.json with specific roots
    const pkgADir = join(testDir, "packages", "pkg-a");
    const pkgBDir = join(testDir, "packages", "pkg-b");
    
    await writeJson(lastPlanPath, {
      rootDir: testDir,
      mode: "local",
      actions: [],
      index: {
        packages: {
          "pkg-a": {
            name: "pkg-a",
            version: "1.0.0",
            // Use path.sep for Windows compatibility
            dir: pkgADir.split(path.sep).join(path.sep),
          },
          "pkg-b": {
            name: "pkg-b",
            version: "2.0.0",
            dir: pkgBDir.split(path.sep).join(path.sep),
          },
        },
      },
    });

    // Run status
    const result = await status({ rootDir: testDir });

    // Should have used roots from plan
    expect(result.packages).toBeGreaterThan(0);
  });

  it("should save state.json after auto-scan", async () => {
    // Run status
    await status({ rootDir: testDir });

    // Check state.json exists and has valid structure
    expect(await exists(stateJsonPath)).toBe(true);
    
    const state = JSON.parse(await fsp.readFile(stateJsonPath, "utf8"));
    expect(state.devlinkVersion).toBeDefined();
    expect(state.generatedAt).toBeDefined();
    expect(state.packages).toBeDefined();
    expect(Array.isArray(state.packages)).toBe(true);
  });

  it("should handle Windows-safe path splitting", async () => {
    // Create plan with mixed path separators
    const mixedPath = `${testDir}\\packages\\pkg-a`.replace(/\\/g, path.sep);
    
    await writeJson(lastPlanPath, {
      rootDir: testDir,
      mode: "local",
      actions: [],
      index: {
        packages: {
          "pkg-a": {
            name: "pkg-a",
            version: "1.0.0",
            dir: mixedPath,
          },
        },
      },
    });

    // Should not throw on Windows paths
    const result = await status({ rootDir: testDir });
    expect(result).toBeDefined();
  });

  it("should return empty status if auto-scan fails", async () => {
    // Use non-existent directory
    const badDir = join(testDir, "non-existent");

    const result = await status({ rootDir: badDir });

    // Should return empty status instead of throwing
    expect(result.packages).toBe(0);
    expect(result.links).toBe(0);
    expect(result.unknown).toBe(0);
    expect(result.entries).toEqual([]);
  });

  it("should use provided roots option over last-plan.json", async () => {
    // Create last-plan.json
    await writeJson(lastPlanPath, {
      rootDir: testDir,
      mode: "local",
      actions: [],
      index: { packages: {} },
    });

    // Run status with explicit roots
    const result = await status({
      rootDir: testDir,
      roots: [testDir],
    });

    // Should have scanned with provided roots
    expect(result.packages).toBeGreaterThan(0);
  });
});

