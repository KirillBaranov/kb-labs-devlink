import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { detectMode } from "../mode-detector";

describe("mode-detector", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "devlink-mode-test-"));
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it("should use explicit mode when provided", async () => {
    const mode = await detectMode(tempDir, "local");
    expect(mode).toBe("local");
  });

  it("should detect mode from last-apply.json", async () => {
    const kbDir = join(tempDir, ".kb", "devlink");
    await fsp.mkdir(kbDir, { recursive: true });
    
    await fsp.writeFile(
      join(kbDir, "last-apply.json"),
      JSON.stringify({
        rootDir: tempDir,
        ts: new Date().toISOString(),
        mode: "yalc",
        actions: [],
      })
    );

    const mode = await detectMode(tempDir);
    expect(mode).toBe("yalc");
  });

  it("should detect mode from lock.json", async () => {
    const kbDir = join(tempDir, ".kb", "devlink");
    await fsp.mkdir(kbDir, { recursive: true });
    
    await fsp.writeFile(
      join(kbDir, "lock.json"),
      JSON.stringify({
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        mode: "local",
        policy: { pin: "exact" },
        consumers: {},
        meta: {
          format: "per-consumer",
          lockVersion: "2.0.0",
          roots: [tempDir],
        },
      })
    );

    const mode = await detectMode(tempDir);
    expect(mode).toBe("local");
  });

  it("should detect mode from lock.json entries with link source", async () => {
    const kbDir = join(tempDir, ".kb", "devlink");
    await fsp.mkdir(kbDir, { recursive: true });
    
    await fsp.writeFile(
      join(kbDir, "lock.json"),
      JSON.stringify({
        schemaVersion: 2,
        generatedAt: new Date().toISOString(),
        mode: "remote",
        policy: { pin: "exact" },
        consumers: {
          "consumer-a": {
            manifest: "packages/a/package.json",
            deps: {
              "provider-b": {
                version: "1.0.0",
                source: "link",
              },
            },
          },
        },
        meta: {
          format: "per-consumer",
          lockVersion: "2.0.0",
          roots: [tempDir],
        },
      })
    );

    const mode = await detectMode(tempDir);
    expect(mode).toBe("local");
  });

  it("should detect mode from manifest with link: prefix", async () => {
    const packagesDir = join(tempDir, "packages");
    const pkgADir = join(packagesDir, "a");
    await fsp.mkdir(pkgADir, { recursive: true });
    
    await fsp.writeFile(
      join(pkgADir, "package.json"),
      JSON.stringify({
        name: "@test/a",
        version: "1.0.0",
        dependencies: {
          "@test/b": "link:../b",
        },
      })
    );

    const mode = await detectMode(tempDir);
    expect(mode).toBe("local");
  });

  it("should normalize workspace mode to local", async () => {
    const kbDir = join(tempDir, ".kb", "devlink");
    await fsp.mkdir(kbDir, { recursive: true });
    
    await fsp.writeFile(
      join(kbDir, "last-apply.json"),
      JSON.stringify({
        rootDir: tempDir,
        ts: new Date().toISOString(),
        mode: "workspace",
        actions: [],
      })
    );

    const mode = await detectMode(tempDir);
    expect(mode).toBe("local");
  });

  it("should default to auto when no mode detected", async () => {
    const mode = await detectMode(tempDir);
    expect(mode).toBe("auto");
  });

  it("should handle corrupted last-apply.json gracefully", async () => {
    const kbDir = join(tempDir, ".kb", "devlink");
    await fsp.mkdir(kbDir, { recursive: true });
    
    await fsp.writeFile(
      join(kbDir, "last-apply.json"),
      "invalid json {{"
    );

    const mode = await detectMode(tempDir);
    expect(mode).toBe("auto");
  });

  it("should handle corrupted lock.json gracefully", async () => {
    const kbDir = join(tempDir, ".kb", "devlink");
    await fsp.mkdir(kbDir, { recursive: true });
    
    await fsp.writeFile(
      join(kbDir, "lock.json"),
      "invalid json {{"
    );

    const mode = await detectMode(tempDir);
    expect(mode).toBe("auto");
  });
});

