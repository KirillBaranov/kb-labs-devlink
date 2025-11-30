import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import * as runCommandModule from '@devlink/shared/utils/runCommand';
import { checkGitDirty } from '@devlink/shared/utils/git';
import { runPreflightChecks } from '@devlink/shared/utils/preflight';
import { scanAndPlan, apply, applyLockFile, undo } from "../api";

describe("Preflight Checks", () => {
  let tmpRoot: string;
  const mockRunCommand = vi.spyOn(runCommandModule, "runCommand");

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), "devlink-preflight-test-"));

    // Create test structure
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

    const pkgBDir = join(tmpRoot, "packages", "b");
    await mkdir(pkgBDir, { recursive: true });
    await writeFile(
      join(pkgBDir, "package.json"),
      JSON.stringify({
        name: "@test/b",
        version: "1.0.0",
        dependencies: {
          "@test/a": "^1.0.0",
        },
      }, null, 2)
    );

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

  describe("checkGitDirty", () => {
    it("should return clean status when not in git repo", async () => {
      mockRunCommand.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "" });

      const status = await checkGitDirty(tmpRoot);

      expect(status.isDirty).toBe(false);
      expect(status.files).toHaveLength(0);
    });

    it("should detect dirty files", async () => {
      // Mock git repo check (success)
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      // Mock git status with dirty files
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "M  packages/a/package.json\n M packages/b/package.json\n",
        stderr: "",
      });

      const status = await checkGitDirty(tmpRoot);

      expect(status.isDirty).toBe(true);
      expect(status.files).toHaveLength(2);
      expect(status.files).toContain("packages/a/package.json");
      expect(status.files).toContain("packages/b/package.json");
    });

    it("should return clean when no dirty files", async () => {
      // Mock git repo check (success)
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      // Mock git status with no changes
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "",
        stderr: "",
      });

      const status = await checkGitDirty(tmpRoot);

      expect(status.isDirty).toBe(false);
      expect(status.files).toHaveLength(0);
    });

    it("should handle git command failure gracefully", async () => {
      // Mock git repo check (success)
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      // Mock git status failure
      mockRunCommand.mockRejectedValueOnce(new Error("Git error"));

      const status = await checkGitDirty(tmpRoot);

      // Should assume clean on error
      expect(status.isDirty).toBe(false);
    });
  });

  // Note: Backup functions removed - now handled by structured backup system in backup-manager.ts

  describe("runPreflightChecks", () => {
    it("should pass when git is clean", async () => {
      // Mock clean git status
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      const result = await runPreflightChecks({
        rootDir: tmpRoot,
        skipConfirmation: false,
        dryRun: false,
      });

      expect(result.ok).toBe(true);
      expect(result.shouldProceed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it("should warn when git is dirty and --yes not provided", async () => {
      // Mock dirty git status
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "M  packages/a/package.json\n",
        stderr: "",
      });

      const result = await runPreflightChecks({
        rootDir: tmpRoot,
        skipConfirmation: false,
        dryRun: false,
      });

      expect(result.ok).toBe(true);
      expect(result.shouldProceed).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("Uncommitted changes"))).toBe(true);
    });

    it("should proceed when git is dirty but --yes provided", async () => {
      // Mock dirty git status
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "M  packages/a/package.json\n",
        stderr: "",
      });

      const result = await runPreflightChecks({
        rootDir: tmpRoot,
        skipConfirmation: true,
        dryRun: false,
      });

      expect(result.ok).toBe(true);
      expect(result.shouldProceed).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes("--yes"))).toBe(true);
    });

    it("should skip checks in dry-run mode", async () => {
      const result = await runPreflightChecks({
        rootDir: tmpRoot,
        skipConfirmation: false,
        dryRun: true,
      });

      expect(result.ok).toBe(true);
      expect(result.shouldProceed).toBe(true);
      expect(result.warnings).toHaveLength(0);

      // Should not have called git
      expect(mockRunCommand).not.toHaveBeenCalled();
    });
  });

  describe("API Integration", () => {
    it("apply should cancel when git dirty and no --yes", async () => {
      // Mock dirty git
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "M  packages/a/package.json\n",
        stderr: "",
      });

      const scanResult = await scanAndPlan({
        rootDir: tmpRoot,
        mode: "local",
      });

      mockRunCommand.mockClear();

      // Mock git again for apply
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "M  packages/a/package.json\n",
        stderr: "",
      });

      const result = await apply(scanResult.plan!, {
        dryRun: false,
        yes: false,
      });

      expect(result.ok).toBe(false);
      expect(result.diagnostics).toContain("✋ Operation cancelled by preflight checks");
      expect(result.warnings?.length).toBeGreaterThan(0);
    });

    it("apply should proceed with --yes flag", async () => {
      // Mock dirty git
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "M  packages/a/package.json\n",
        stderr: "",
      });

      const scanResult = await scanAndPlan({
        rootDir: tmpRoot,
        mode: "local",
      });

      mockRunCommand.mockClear();

      // Mock git for apply
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({
        code: 0,
        stdout: "M  packages/a/package.json\n",
        stderr: "",
      });

      // Mock actual commands
      mockRunCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      const result = await apply(scanResult.plan!, {
        dryRun: false,
        yes: true,
      });

      expect(result.ok).toBe(true);
      expect(result.warnings?.length).toBeGreaterThan(0);
      expect(result.warnings?.some((w) => w.includes("--yes"))).toBe(true);
    });

    it("applyLockFile should create backups before mutation", async () => {
      // Create a lock file first
      const scanResult = await scanAndPlan({
        rootDir: tmpRoot,
        mode: "local",
      });

      const { freeze } = await import("../api");
      await freeze(scanResult.plan!);

      mockRunCommand.mockClear();

      // Mock clean git
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      // Mock actual commands
      mockRunCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      const result = await applyLockFile({
        rootDir: tmpRoot,
        dryRun: false,
        yes: true,
      });

      // Verify backup was created
      const { exists } = await import('@devlink/shared/utils/fs');
      const backupDir = join(tmpRoot, ".kb", "devlink", "backups");
      expect(await exists(backupDir)).toBe(true);
    });

    it("undo should create backups before mutation", async () => {
      // First do an apply
      const scanResult = await scanAndPlan({
        rootDir: tmpRoot,
        mode: "local",
      });

      mockRunCommand.mockClear();
      mockRunCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      await apply(scanResult.plan!, { dryRun: false, yes: true });

      mockRunCommand.mockClear();

      // Mock clean git for undo
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });
      mockRunCommand.mockResolvedValueOnce({ code: 0, stdout: "", stderr: "" });

      // Mock actual commands
      mockRunCommand.mockResolvedValue({ code: 0, stdout: "", stderr: "" });

      const result = await undo({
        rootDir: tmpRoot,
        dryRun: false,
        yes: true,
      });

      expect(result.ok).toBe(true);

      // Verify backups exist (at least 2 timestamps worth)
      const { exists } = await import('@devlink/shared/utils/fs');
      const backupDir = join(tmpRoot, ".kb", "devlink", "backups");
      expect(await exists(backupDir)).toBe(true);
    });
  });
});

