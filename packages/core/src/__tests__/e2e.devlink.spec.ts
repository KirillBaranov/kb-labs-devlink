import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { scanPackages } from '@devlink/application/devlink/legacy/scan';
import { buildPlan } from '@devlink/application/devlink/legacy/plan';
import { applyPlan } from '@devlink/application/devlink/legacy/apply';
import { freezeToLock } from '@devlink/application/devlink/legacy/lock';
import { undoLastApply, readLastApply } from '@devlink/application/devlink/legacy/journal';
import { status } from "../api";
import * as runCommandModule from '@devlink/shared/utils/runCommand';

describe("DevLink E2E", () => {
  let tmpRoot: string;
  let pkgADir: string;
  let pkgBDir: string;

  // Mock runCommand to avoid actually running yalc/pnpm
  const mockRunCommand = vi.spyOn(runCommandModule, "runCommand");

  beforeEach(async () => {
    // Create temp directory structure
    tmpRoot = await mkdtemp(join(tmpdir(), "devlink-test-"));

    // Create package A (@test/a)
    pkgADir = join(tmpRoot, "packages", "a");
    await mkdir(pkgADir, { recursive: true });
    await writeFile(
      join(pkgADir, "package.json"),
      JSON.stringify({
        name: "@test/a",
        version: "1.0.0",
        dependencies: {},
      }, null, 2)
    );

    // Create package B (@test/b) that depends on A
    pkgBDir = join(tmpRoot, "packages", "b");
    await mkdir(pkgBDir, { recursive: true });
    await writeFile(
      join(pkgBDir, "package.json"),
      JSON.stringify({
        name: "@test/b",
        version: "1.0.0",
        dependencies: {
          "@test/a": "^1.0.0",
          "lodash": "^4.17.0",
        },
      }, null, 2)
    );

    // Create root package.json
    await writeFile(
      join(tmpRoot, "package.json"),
      JSON.stringify({
        name: "test-monorepo",
        version: "1.0.0",
        private: true,
      }, null, 2)
    );

    // Mock runCommand to simulate success
    mockRunCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(async () => {
    // Clean up temp directory
    await rm(tmpRoot, { recursive: true, force: true });
    mockRunCommand.mockClear();
  });

  it("should scan packages and build index", async () => {
    const result = await scanPackages({ rootDir: tmpRoot });

    expect(result.state.packages).toHaveLength(3); // root + a + b
    expect(result.index.packages["@test/a"]).toBeDefined();
    expect(result.index.packages["@test/b"]).toBeDefined();
    expect(result.graph.nodes).toContain("@test/a");
    expect(result.graph.nodes).toContain("@test/b");
  });

  it("should build plan in local mode", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, { mode: "local" });

    expect(plan.actions).toBeDefined();
    expect(plan.mode).toBe("local");

    // Should have link-local for @test/a (since it's local)
    const linkLocalAction = plan.actions.find(
      (a) => a.dep === "@test/a" && a.kind === "link-local"
    );
    expect(linkLocalAction).toBeDefined();
    expect(linkLocalAction?.target).toBe("@test/b");

    // Should have use-npm for lodash (external)
    const useNpmAction = plan.actions.find(
      (a) => a.dep === "lodash" && a.kind === "use-npm"
    );
    expect(useNpmAction).toBeDefined();
  });

  it("should print dry-run table", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, { mode: "local" });

    // Capture console output
    const consoleLogs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      consoleLogs.push(args.join(" "));
    };

    const result = await applyPlan(plan, { dryRun: true });

    console.log = originalLog;

    // Check that dry-run table was printed
    const output = consoleLogs.join("\n");
    expect(output).toContain("DevLink Plan (DRY RUN)");
    expect(output).toContain("Mode: local");
    expect(output).toContain("TARGET");
    expect(output).toContain("DEPENDENCY");
    expect(output).toContain("KIND");

    // Should not have executed anything
    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(result.executed).toHaveLength(plan.actions.length);
  });

  it("should apply plan and call yalc/pnpm commands", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, { mode: "local" });

    const result = await applyPlan(plan, { dryRun: false });

    // Check that commands were called
    expect(mockRunCommand).toHaveBeenCalled();

    // Should have called yalc add for @test/a
    const yalcCalls = mockRunCommand.mock.calls.filter(
      (call) => call[0].includes("yalc add @test/a")
    );
    expect(yalcCalls.length).toBeGreaterThan(0);

    expect(result.ok).toBe(true);
    expect(result.executed.length).toBeGreaterThan(0);
  });

  it("should create lock file", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, { mode: "local" });

    await freezeToLock(plan, tmpRoot);

    // Verify lock file was created
    const { readJson, exists } = await import('@devlink/shared/utils/fs');
    const lockPath = join(tmpRoot, ".kb", "devlink", "lock.json");
    expect(await exists(lockPath)).toBe(true);

    const lockFile = await readJson(lockPath);
    expect(lockFile.consumers).toBeDefined();
    expect(Object.keys(lockFile.consumers || {}).length).toBeGreaterThan(0);
    expect(lockFile.mode).toBe("local");
  });

  it("should write and read last-apply journal", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, { mode: "local" });

    await applyPlan(plan, { dryRun: false });

    const journal = await readLastApply(tmpRoot);
    expect(journal).toBeDefined();
    expect(journal?.mode).toBe("local");
    expect(journal?.actions.length).toBeGreaterThan(0);
  });

  it("should undo last apply in dry-run", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, { mode: "local" });

    await applyPlan(plan, { dryRun: false });

    // Clear mock calls from apply
    mockRunCommand.mockClear();

    // Undo in dry-run should not fail
    await expect(undoLastApply(tmpRoot, { dryRun: true })).resolves.not.toThrow();

    // Should not have called any commands in dry-run
    expect(mockRunCommand).not.toHaveBeenCalled();
  });

  it("should handle policy.deny correctly", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, {
      mode: "auto",
      policy: {
        deny: ["@test/a"],
      },
    });

    // @test/a should be skipped
    const linkLocalAction = plan.actions.find(
      (a) => a.dep === "@test/a"
    );
    expect(linkLocalAction).toBeUndefined();

    // Should have diagnostic message
    expect(plan.diagnostics.length).toBeGreaterThan(0);
    const denyDiagnostic = plan.diagnostics.find(d =>
      d.includes("denied by policy")
    );
    expect(denyDiagnostic).toBeDefined();
  });

  it("should handle policy.forceLocal correctly", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, {
      mode: "npm",
      policy: {
        forceLocal: ["@test/a"],
      },
    });

    // @test/a should be link-local even in npm mode
    const linkLocalAction = plan.actions.find(
      (a) => a.dep === "@test/a" && a.kind === "link-local"
    );
    expect(linkLocalAction).toBeDefined();
    expect(linkLocalAction?.reason).toBe("forceLocal policy");
  });

  it("should handle policy.forceNpm correctly", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, {
      mode: "local",
      policy: {
        forceNpm: ["@test/a"],
      },
    });

    // @test/a should be use-npm even in local mode
    const useNpmAction = plan.actions.find(
      (a) => a.dep === "@test/a" && a.kind === "use-npm"
    );
    expect(useNpmAction).toBeDefined();
    expect(useNpmAction?.reason).toBe("forceNpm policy");
  });

  it("should deduplicate and sort actions deterministically", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan1 = await buildPlan(index, graph, { mode: "local" });
    const plan2 = await buildPlan(index, graph, { mode: "local" });

    // Actions should be identical and in same order
    expect(plan1.actions).toEqual(plan2.actions);

    // Check that actions are sorted
    for (let i = 1; i < plan1.actions.length; i++) {
      const prev = plan1.actions[i - 1]!;
      const curr = plan1.actions[i]!;

      // Should be sorted by target, then dep, then kind
      const prevKey = `${prev.target}::${prev.dep}::${prev.kind}`;
      const currKey = `${curr.target}::${curr.dep}::${curr.kind}`;
      expect(prevKey.localeCompare(currKey)).toBeLessThanOrEqual(0);
    }
  });

  it("should get status", async () => {
    const { state: _state, index, graph } = await scanPackages({ rootDir: tmpRoot });
    const plan = await buildPlan(index, graph, { mode: "local" });
    await applyPlan(plan, { dryRun: false });

    const statusResult = await status({ rootDir: tmpRoot });

    expect(statusResult.lock.consumers).toBeGreaterThan(0);
    const entries = statusResult.lock.entries ?? [];
    expect(entries.length).toBeGreaterThan(0);
  });
});

