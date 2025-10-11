import { promises as fsp } from "fs";
import { join, dirname, relative } from "path";
import { exists, writeJson, readJson } from "./fs";
import { logger } from "./logger";

export interface BackupOptions {
  rootDir: string;
  timestamp?: string;
}

export interface BackupResult {
  ok: boolean;
  backupPath: string;
  error?: string;
}

/**
 * Create backup of a file under .kb/devlink/backups/<timestamp>/<relative-path>
 */
export async function backupFile(
  filePath: string,
  opts: BackupOptions
): Promise<BackupResult> {
  try {
    if (!(await exists(filePath))) {
      return {
        ok: false,
        backupPath: "",
        error: `File does not exist: ${filePath}`,
      };
    }

    const timestamp = opts.timestamp ?? new Date().toISOString().replace(/:/g, "-");
    const relativePath = relative(opts.rootDir, filePath);
    const backupPath = join(
      opts.rootDir,
      ".kb",
      "devlink",
      "backups",
      timestamp,
      relativePath
    );

    // Ensure backup directory exists
    await fsp.mkdir(dirname(backupPath), { recursive: true });

    // Copy file (preserve JSON formatting if it's JSON)
    if (filePath.endsWith(".json")) {
      const data = await readJson(filePath);
      await writeJson(backupPath, data);
    } else {
      await fsp.copyFile(filePath, backupPath);
    }

    logger.debug("Backup created", { original: filePath, backup: backupPath });

    return {
      ok: true,
      backupPath,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn("Failed to create backup", { filePath, error: errorMessage });

    return {
      ok: false,
      backupPath: "",
      error: errorMessage,
    };
  }
}

/**
 * Backup all package.json files in a directory tree
 */
export async function backupPackageJsons(
  rootDir: string,
  packageDirs: string[],
  opts?: { timestamp?: string }
): Promise<BackupResult[]> {
  const timestamp = opts?.timestamp ?? new Date().toISOString().replace(/:/g, "-");
  const results: BackupResult[] = [];

  for (const pkgDir of packageDirs) {
    const pkgJsonPath = join(pkgDir, "package.json");
    if (await exists(pkgJsonPath)) {
      const result = await backupFile(pkgJsonPath, {
        rootDir,
        timestamp,
      });
      results.push(result);
    }
  }

  const successful = results.filter((r) => r.ok).length;
  logger.info("Package.json backups created", {
    total: results.length,
    successful,
    timestamp,
  });

  return results;
}

