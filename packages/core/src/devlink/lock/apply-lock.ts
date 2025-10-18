import { promises as fsp } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { logger } from "../../utils/logger";
import type { LockFile, LockConsumer } from "./freeze";
import type { PackageJson } from "../../types";

/** Compute SHA256 checksum of file */
async function checksumFile(filePath: string): Promise<string> {
  try {
    const content = await fsp.readFile(filePath, "utf-8");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return `sha256:${hash}`;
  } catch {
    return "";
  }
}

/**
 * Apply lock file: update package.json files with locked versions
 */
export async function applyLock(
  lockPath: string,
  rootDir: string,
  opts: { dryRun?: boolean } = {}
): Promise<{ applied: number; skipped: number; drifted: string[] }> {
  const { dryRun = false } = opts;
  
  // Read lock
  const content = await fsp.readFile(lockPath, "utf-8");
  const lock = JSON.parse(content) as LockFile;
  
  // Validate structure
  if (!lock.consumers || typeof lock.consumers !== 'object') {
    throw new Error("Invalid lock.json structure. Delete .kb/devlink/lock.json and re-freeze.");
  }
  
  let applied = 0;
  let skipped = 0;
  const drifted: string[] = [];
  
  // Apply each consumer
  for (const [consumerName, consumer] of Object.entries(lock.consumers)) {
    const manifestPath = path.resolve(rootDir, consumer.manifest);
    
    // Check drift
    if (consumer.checksum) {
      const currentChecksum = await checksumFile(manifestPath);
      if (currentChecksum && currentChecksum !== consumer.checksum) {
        logger.warn("Manifest changed since freeze; lock may be stale", {
          consumer: consumerName,
          manifest: manifestPath,
        });
        drifted.push(consumerName);
      }
    }
    
    // Read package.json
    let pkg: PackageJson;
    try {
      const pkgContent = await fsp.readFile(manifestPath, "utf-8");
      pkg = JSON.parse(pkgContent);
    } catch (err) {
      logger.warn("Skipping consumer (manifest not found)", {
        consumer: consumerName,
        manifest: manifestPath,
      });
      skipped++;
      continue;
    }
    
    // Apply deps to appropriate sections
    let modified = false;
    
    for (const [depName, entry] of Object.entries(consumer.deps)) {
      // Determine section
      const section = pkg.dependencies?.[depName] ? "dependencies"
        : pkg.devDependencies?.[depName] ? "devDependencies"
        : pkg.peerDependencies?.[depName] ? "peerDependencies"
        : "dependencies";
      
      if (!pkg[section]) {
        pkg[section] = {};
      }
      
      // Apply version from lock
      if (pkg[section]![depName] !== entry.version) {
        logger.debug("Applying lock entry", {
          consumer: consumerName,
          dep: depName,
          old: pkg[section]![depName],
          new: entry.version,
        });
        
        pkg[section]![depName] = entry.version;
        modified = true;
      }
    }
    
    if (modified) {
      if (!dryRun) {
        await fsp.writeFile(manifestPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
      }
      applied++;
    } else {
      skipped++;
    }
  }
  
  logger.info(dryRun ? "[dry-run] Would apply lock" : "Applied lock", {
    applied,
    skipped,
    drifted: drifted.length,
  });
  
  return { applied, skipped, drifted };
}

