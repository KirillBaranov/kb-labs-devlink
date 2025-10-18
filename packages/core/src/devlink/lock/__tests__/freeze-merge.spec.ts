import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { freezeToLockMerged, type FreezeDryRunResult } from "../freeze";
import { readJson, writeJson, exists } from "../../../utils/fs";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import type { DevLinkPlan } from "../../types";

describe("freezeToLockMerged", () => {
  const testDir = join(__dirname, "__test-freeze-merge__");
  const lockPath = join(testDir, ".kb/devlink/lock.json");

  // Mock plan for testing
  const createMockPlan = (actions: Array<{ dep: string; target: string }>): DevLinkPlan => ({
    rootDir: testDir,
    mode: "local",
    actions: actions.map(a => ({
      ...a,
      kind: "link-local" as const,
      reason: "test",
    })),
    graph: { nodes: [], edges: [], topological: [], cycles: [] },
    index: {
      rootDir: testDir,
      packages: {
        "pkg-a": { name: "pkg-a", version: "1.0.0", dir: join(testDir, "packages/pkg-a"), pkg: {} as any, manifest: {} },
        "pkg-b": { name: "pkg-b", version: "2.0.0", dir: join(testDir, "packages/pkg-b"), pkg: {} as any, manifest: {} },
      },
      byDir: {},
    },
    policy: { pin: "caret" },
    diagnostics: [],
  });

  beforeEach(async () => {
    // Create test directory
    await fsp.mkdir(testDir, { recursive: true });
    await fsp.mkdir(join(testDir, "packages/pkg-a"), { recursive: true });
    await fsp.mkdir(join(testDir, "packages/pkg-b"), { recursive: true });
    
    // Create package.json files
    await writeJson(join(testDir, "packages/pkg-a/package.json"), {
      name: "pkg-a",
      version: "1.0.0",
      dependencies: { "pkg-b": "^2.0.0" },
    });
    
    await writeJson(join(testDir, "packages/pkg-b/package.json"), {
      name: "pkg-b",
      version: "2.0.0",
    });
  });

  afterEach(async () => {
    // Cleanup test directory
    try {
      await fsp.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should not write lock.json on dry-run", async () => {
    const plan = createMockPlan([
      { dep: "pkg-b", target: "pkg-a" },
    ]);

    const res = await freezeToLockMerged(plan, testDir, { dryRun: true }) as FreezeDryRunResult;
    
    expect(await exists(lockPath)).toBe(false);
    expect(res?.added).toBeDefined();
    expect(res?.added.length).toBeGreaterThan(0);
  });

  it("should merge with existing lock entries", async () => {
    // Create initial lock
    await writeJson(lockPath, {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {
        "old-pkg": { version: "^1.0.0", source: "npm" },
      },
    });

    const plan = createMockPlan([
      { dep: "pkg-b", target: "pkg-a" },
    ]);

    await freezeToLockMerged(plan, testDir, { replace: false, prune: false });

    const lock = await readJson<any>(lockPath);
    expect(lock.packages["old-pkg"]).toBeDefined();
    expect(lock.packages["pkg-b"]).toBeDefined();
  });

  it("should replace all entries when replace=true", async () => {
    // Create initial lock
    await writeJson(lockPath, {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {
        "old-pkg": { version: "^1.0.0", source: "npm" },
      },
    });

    const plan = createMockPlan([
      { dep: "pkg-b", target: "pkg-a" },
    ]);

    await freezeToLockMerged(plan, testDir, { replace: true });

    const lock = await readJson<any>(lockPath);
    expect(lock.packages["old-pkg"]).toBeUndefined();
    expect(lock.packages["pkg-b"]).toBeDefined();
  });

  it("should prune entries not in plan when prune=true", async () => {
    // Create initial lock
    await writeJson(lockPath, {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {
        "old-pkg": { version: "^1.0.0", source: "npm" },
        "pkg-b": { version: "^1.0.0", source: "npm" },
      },
    });

    const plan = createMockPlan([
      { dep: "pkg-b", target: "pkg-a" },
    ]);

    await freezeToLockMerged(plan, testDir, { prune: true });

    const lock = await readJson<any>(lockPath);
    expect(lock.packages["old-pkg"]).toBeUndefined();
    expect(lock.packages["pkg-b"]).toBeDefined();
  });

  it("should detect workspace source for same-workspace packages", async () => {
    const plan = createMockPlan([
      { dep: "pkg-b", target: "pkg-a" },
    ]);

    await freezeToLockMerged(plan, testDir, {});

    const lock = await readJson<any>(lockPath);
    expect(lock.packages["pkg-b"].source).toBe("workspace");
  });

  it("should detect github source for github: prefix", async () => {
    const planWithGithub: DevLinkPlan = {
      ...createMockPlan([]),
      actions: [{
        dep: "github:user/repo",
        target: "pkg-a",
        kind: "link-local" as const,
        reason: "test",
      }],
    };

    await freezeToLockMerged(planWithGithub, testDir, {});

    const lock = await readJson<any>(lockPath);
    expect(lock.packages["github:user/repo"].source).toBe("github");
  });
});

