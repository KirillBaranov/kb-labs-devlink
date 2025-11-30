import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import {
  scanAndPlan,
  apply,
  freeze,
  applyLockFile,
  undo,
  status,
} from "../api";
import * as runCommandModule from '@devlink/shared/utils/runCommand';

describe("API Facade", () => {
  let tmpRoot: string;
  const mockRunCommand = vi.spyOn(runCommandModule, "runCommand");

  beforeEach(async () => {
    // Create temp directory structure
    tmpRoot = await mkdtemp(join(tmpdir(), "devlink-api-test-"));

    // Create package A (@test/a)
    const pkgADir = join(tmpRoot, "packages", "a");
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
    const pkgBDir = join(tmpRoot, "packages", "b");
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

    mockRunCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    mockRunCommand.mockClear();
  });

  it("scanAndPlan returns plan and timings", async () => {
    const result = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();
    expect(result.plan?.actions).toBeDefined();
    expect(result.timings).toBeDefined();
    expect(result.timings.total).toBeGreaterThan(0);
    expect(result.timings.discovery).toBeGreaterThan(0);
    expect(result.diagnostics).toBeInstanceOf(Array);
  });

  it("scanAndPlan handles policy options", async () => {
    const result = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
      policy: {
        deny: ["@test/a"],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.plan).toBeDefined();

    // @test/a should be denied
    const deniedAction = result.plan?.actions.find(
      (a) => a.dep === "@test/a"
    );
    expect(deniedAction).toBeUndefined();

    // Should have diagnostics about denial
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("apply with dryRun does not write state/journal", async () => {
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });

    expect(scanResult.ok).toBe(true);
    expect(scanResult.plan).toBeDefined();

    const applyResult = await apply(scanResult.plan!, {
      dryRun: true,
    });

    expect(applyResult.ok).toBe(true);
    expect(applyResult.executed.length).toBeGreaterThan(0);

    // Should not have called any commands in dry-run
    expect(mockRunCommand).not.toHaveBeenCalled();

    // Check that state file was not created
    const { exists } = await import('@devlink/shared/utils/fs');
    const statePath = join(tmpRoot, ".kb", "devlink", "state.json");
    expect(await exists(statePath)).toBe(false);
  });

  it("apply executes and writes state/journal", async () => {
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });

    expect(scanResult.ok).toBe(true);
    expect(scanResult.plan).toBeDefined();

    const applyResult = await apply(scanResult.plan!, {
      dryRun: false,
    });

    expect(applyResult.ok).toBe(true);
    expect(applyResult.executed.length).toBeGreaterThan(0);

    // Should have called commands
    expect(mockRunCommand).toHaveBeenCalled();

    // Check that state and journal were created
    const { exists } = await import('@devlink/shared/utils/fs');
    const statePath = join(tmpRoot, ".kb", "devlink", "state.json");
    const journalPath = join(tmpRoot, ".kb", "devlink", "last-apply.json");

    expect(await exists(statePath)).toBe(true);
    expect(await exists(journalPath)).toBe(true);
  });

  it("freeze creates lock file", async () => {
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });

    expect(scanResult.ok).toBe(true);
    expect(scanResult.plan).toBeDefined();

    const freezeResult = await freeze(scanResult.plan!);

    expect(freezeResult.ok).toBe(true);
    expect(freezeResult.lockPath).toBeDefined();
    expect(freezeResult.lockPath).toContain("lock.json");

    // Verify lock file was created
    const { exists } = await import('@devlink/shared/utils/fs');
    expect(await exists(freezeResult.lockPath)).toBe(true);
  });

  it("freeze with pin option updates policy", async () => {
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });

    expect(scanResult.ok).toBe(true);
    expect(scanResult.plan).toBeDefined();

    const freezeResult = await freeze(scanResult.plan!, {
      pin: "exact",
    });

    expect(freezeResult.ok).toBe(true);

    // Check that lock file was created with exact versions
    const { readJson } = await import('@devlink/shared/utils/fs');
    const lockFile = await readJson(freezeResult.lockPath);
    expect(lockFile).toBeDefined();
  });

  it("applyLockFile works without exceptions", async () => {
    // First create a lock file
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });
    await freeze(scanResult.plan!);

    mockRunCommand.mockClear();

    // Now apply lock
    const result = await applyLockFile({
      rootDir: tmpRoot,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toBeInstanceOf(Array);
    expect(mockRunCommand).not.toHaveBeenCalled(); // dry-run
  });

  it("undo works without exceptions", async () => {
    // First apply something
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });
    await apply(scanResult.plan!, { dryRun: false });

    mockRunCommand.mockClear();

    // Now undo
    const result = await undo({
      rootDir: tmpRoot,
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toBeInstanceOf(Array);
    expect(mockRunCommand).not.toHaveBeenCalled(); // dry-run
  });

  it("status returns report", async () => {
    // First apply something
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });
    await apply(scanResult.plan!, { dryRun: false });

    const statusResult = await status({
      rootDir: tmpRoot,
    });

    expect(statusResult).toBeDefined();
    expect(statusResult.lock.consumers).toBeGreaterThan(0);
    expect(statusResult.lock.deps).toBeGreaterThanOrEqual(0);
    expect(statusResult.lock.entries ?? []).toBeInstanceOf(Array);
    expect(statusResult.context.mode).toBeDefined();
  });

  it("scanAndPlan reports cycles in diagnostics", async () => {
    // Create circular dependency
    const pkgCDir = join(tmpRoot, "packages", "c");
    await mkdir(pkgCDir, { recursive: true });
    await writeFile(
      join(pkgCDir, "package.json"),
      JSON.stringify({
        name: "@test/c",
        version: "1.0.0",
        dependencies: {
          "@test/a": "^1.0.0",
        },
      }, null, 2)
    );

    // Make A depend on C (circular)
    await writeFile(
      join(tmpRoot, "packages", "a", "package.json"),
      JSON.stringify({
        name: "@test/a",
        version: "1.0.0",
        dependencies: {
          "@test/c": "^1.0.0",
        },
      }, null, 2)
    );

    const result = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });

    expect(result.ok).toBe(true);
    // Should have warnings about cycles
    const cyclesDiagnostic = result.diagnostics.find(d =>
      d.includes("cycle")
    );
    expect(cyclesDiagnostic).toBeDefined();
  });

  it("apply returns errors when commands fail", async () => {
    const scanResult = await scanAndPlan({
      rootDir: tmpRoot,
      mode: "local",
    });

    // Mock command to fail
    mockRunCommand.mockRejectedValue(new Error("Command failed"));

    const applyResult = await apply(scanResult.plan!, {
      dryRun: false,
    });

    // Should still return a result, just with errors
    expect(applyResult).toBeDefined();
    expect(applyResult.errors).toBeDefined();
  });
});

