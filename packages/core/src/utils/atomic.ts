/**
 * Atomic file operations for crash safety
 */

import { promises as fsp } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { exists } from "./fs";

/**
 * Atomic JSON write via tmp + rename
 * Windows-safe: unlink existing file first
 */
export async function writeJsonAtomic<T>(
  filePath: string,
  data: T
): Promise<void> {
  const tmp = `${filePath}.tmp`;
  const content = JSON.stringify(data, null, 2);

  // Write to temp file
  await fsp.writeFile(tmp, content, "utf-8");

  // Windows-safe atomic rename
  if (process.platform === "win32") {
    // On Windows, rename over existing file isn't atomic
    // Need to unlink first (ignore ENOENT if doesn't exist)
    try {
      await fsp.unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  // Rename tmp to final location
  await fsp.rename(tmp, filePath);
}

/**
 * Compute SHA256 checksum for string content
 */
export function computeChecksum(content: string): string {
  const hash = crypto.createHash("sha256").update(content, "utf-8").digest("hex");
  return `sha256:${hash}`;
}

/**
 * Compute SHA256 checksum for file (streaming for large files)
 */
export async function computeFileChecksum(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fsp.open(filePath, "r").then((handle) => handle.createReadStream());

    stream
      .then((s) => {
        s.on("data", (chunk) => hash.update(chunk));
        s.on("end", () => resolve(`sha256:${hash.digest("hex")}`));
        s.on("error", reject);
      })
      .catch(reject);
  });
}

/**
 * Advisory lock for preventing concurrent operations
 */
export class AdvisoryLock {
  private lockPath: string;
  private staleTimeout: number; // ms

  constructor(lockPath: string, staleTimeout = 5 * 60 * 1000) {
    this.lockPath = lockPath;
    this.staleTimeout = staleTimeout;
  }

  /**
   * Acquire lock, throw if already held
   */
  async acquire(): Promise<void> {
    // Check if lock exists
    if (await exists(this.lockPath)) {
      // Check if stale
      const stats = await fsp.stat(this.lockPath);
      const age = Date.now() - stats.mtime.getTime();

      if (age < this.staleTimeout) {
        throw new Error("LOCK_HELD: Another operation is in progress");
      }

      // Stale lock, remove it
      await fsp.unlink(this.lockPath).catch(() => {});
    }

    // Create lock file
    const lockData = {
      pid: process.pid,
      timestamp: new Date().toISOString(),
    };

    // Ensure directory exists
    await fsp.mkdir(path.dirname(this.lockPath), { recursive: true });
    await fsp.writeFile(this.lockPath, JSON.stringify(lockData), "utf-8");
  }

  /**
   * Release lock
   */
  async release(): Promise<void> {
    try {
      await fsp.unlink(this.lockPath);
    } catch {
      // Ignore errors on release
    }
  }

  /**
   * Execute function with lock held
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
}

/**
 * Clean up temporary files in directory
 */
export async function cleanupTempFiles(dirPath: string): Promise<number> {
  try {
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    let cleaned = 0;

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".tmp")) {
        const tmpPath = path.join(dirPath, entry.name);
        await fsp.unlink(tmpPath).catch(() => {});
        cleaned++;
      }
    }

    return cleaned;
  } catch {
    return 0;
  }
}

