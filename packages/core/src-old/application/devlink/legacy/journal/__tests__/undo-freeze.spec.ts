import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { undoLastOperation } from "../undo";
import { writeLastFreeze, readLastFreeze, writeLastApply } from "../last-apply";
import { writeJson, exists } from '@devlink/shared/utils/fs';
import { promises as fsp } from "node:fs";
import { join } from "node:path";

describe("undoLastOperation", () => {
  const testDir = join(__dirname, "__test-undo-freeze__");
  const lockPath = join(testDir, ".kb/devlink/lock.json");
  const backupDir = join(testDir, ".kb/devlink/backups/2025-10-18__10-00-00-000Z");

  beforeEach(async () => {
    // Create test directory structure
    await fsp.mkdir(testDir, { recursive: true });
    await fsp.mkdir(backupDir, { recursive: true });
  });

  afterEach(async () => {
    // Cleanup
    try {
      await fsp.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should mark journal as undone instead of deleting", async () => {
    // Create lock and backup
    const lockData = {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {
        "pkg-a": { version: "^1.0.0", source: "npm" as const },
      },
    };
    
    await writeJson(lockPath, lockData);
    await writeJson(join(backupDir, "lock.json"), {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {},
    });

    // Create freeze journal
    await writeLastFreeze({
      operation: "freeze",
      ts: "2025-10-18__10-00-00-000Z",
      rootDir: testDir,
      lockPath,
      backupDir,
      packagesCount: 1,
      pin: "caret",
    });

    // Undo
    await undoLastOperation(testDir);

    // Check journal is marked undone
    const journal = await readLastFreeze(testDir);
    expect(journal).not.toBeNull();
    expect(journal?.undone).toBe(true);
  });

  it("should choose latest operation by mtime (freeze wins)", async () => {
    // Create older apply journal
    await writeLastApply({
      rootDir: testDir,
      ts: "2025-10-18T09:00:00.000Z",
      mode: "local",
      actions: [],
    });
    
    // Wait a bit to ensure mtime difference
    await new Promise(resolve => setTimeout(resolve, 10));

    // Create newer freeze journal
    await writeJson(join(backupDir, "lock.json"), {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {},
    });
    
    await writeJson(lockPath, {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: { "pkg-a": { version: "^1.0.0", source: "npm" } },
    });

    await writeLastFreeze({
      operation: "freeze",
      ts: "2025-10-18__10-00-00-000Z",
      rootDir: testDir,
      lockPath,
      backupDir,
      packagesCount: 1,
      pin: "caret",
    });

    // Undo should choose freeze
    const result = await undoLastOperation(testDir);
    expect(result.type).toBe("freeze");
  });

  it("should byte-restore lock.json from backup", async () => {
    const originalLock = {
      generatedAt: "2025-10-18T09:00:00.000Z",
      mode: "local",
      packages: {
        "original-pkg": { version: "^1.0.0", source: "npm" as const },
      },
    };

    const newLock = {
      generatedAt: "2025-10-18T10:00:00.000Z",
      mode: "local",
      packages: {
        "new-pkg": { version: "^2.0.0", source: "npm" as const },
      },
    };

    // Create backup with original
    await writeJson(join(backupDir, "lock.json"), originalLock);
    
    // Create current lock with new
    await writeJson(lockPath, newLock);

    // Create freeze journal
    await writeLastFreeze({
      operation: "freeze",
      ts: "2025-10-18__10-00-00-000Z",
      rootDir: testDir,
      lockPath,
      backupDir,
      packagesCount: 1,
      pin: "caret",
    });

    // Undo
    await undoLastOperation(testDir);

    // Check lock restored to original
    const restoredLock = JSON.parse(await fsp.readFile(lockPath, "utf8"));
    expect(restoredLock.packages["original-pkg"]).toBeDefined();
    expect(restoredLock.packages["new-pkg"]).toBeUndefined();
  });

  it("should throw error if freeze already undone", async () => {
    // Create freeze journal marked as undone
    await writeLastFreeze({
      operation: "freeze",
      ts: "2025-10-18__10-00-00-000Z",
      rootDir: testDir,
      lockPath,
      backupDir,
      packagesCount: 1,
      pin: "caret",
      undone: true,
    });

    await expect(undoLastOperation(testDir)).rejects.toThrow("already undone");
  });

  it("should handle dry-run without mutations", async () => {
    const lockData = {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {
        "pkg-a": { version: "^1.0.0", source: "npm" as const },
      },
    };
    
    await writeJson(lockPath, lockData);
    await writeJson(join(backupDir, "lock.json"), {
      generatedAt: new Date().toISOString(),
      mode: "local",
      packages: {},
    });

    await writeLastFreeze({
      operation: "freeze",
      ts: "2025-10-18__10-00-00-000Z",
      rootDir: testDir,
      lockPath,
      backupDir,
      packagesCount: 1,
      pin: "caret",
    });

    // Dry-run
    const result = await undoLastOperation(testDir, { dryRun: true });

    // Check nothing changed
    expect(result.type).toBe("freeze");
    const journal = await readLastFreeze(testDir);
    expect(journal?.undone).toBeUndefined();
    
    const currentLock = JSON.parse(await fsp.readFile(lockPath, "utf8"));
    expect(currentLock.packages["pkg-a"]).toBeDefined();
  });
});

