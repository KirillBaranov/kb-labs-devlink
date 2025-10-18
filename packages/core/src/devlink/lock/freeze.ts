import { promises as fsp } from "node:fs";
import path from "node:path";
import { join } from "node:path";
import crypto from "node:crypto";
import { writeJson, readJson, exists } from "../../utils/fs";
import type { DevLinkPlan } from "../types";
import { logger } from "../../utils/logger";
import { resolveInstalledVersionNear } from "../../discovery";

export interface LockFile {
  schemaVersion: 2;
  generatedAt: string;
  mode: "local" | "remote";
  policy: { pin: "exact" | "caret" };
  consumers: Record<string, LockConsumer>;
  meta: LockMeta;
  updates?: LockUpdates;
}

export interface LockMeta {
  format: "per-consumer";
  lockVersion: string;
  roots: string[];
  hash?: string;
  reason?: string;
  initiatedBy?: string;
  command?: string;
  createdAt?: string;
}

export interface LockConsumer {
  manifest: string;
  checksum?: string;
  deps: Record<string, LockEntry>;
  extends?: string[];
  overrides?: Record<string, string>;
}

export interface LockEntry {
  version: string;
  source: "npm" | "workspace" | "link" | "github";
  sourceHint?: SourceHint;
}

export interface SourceHint {
  resolvedFrom?: string;
  integrity?: string;
  registry?: string;
}

export interface LockUpdates {
  lastChecked: string | null;
  available: Record<string, {
    current: string;
    latest: string;
    risk?: number;
  }>;
}

/** Try read JSON safely */
async function readJsonSafe<T = any>(file: string): Promise<T | undefined> {
  try {
    const buf = await fsp.readFile(file, "utf8");
    return JSON.parse(buf) as T;
  } catch {
    return undefined;
  }
}

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

/** Check if dep is declared in manifest */
async function isDeclaredInManifest(dep: string, consumerDir: string): Promise<boolean> {
  try {
    const pkgPath = path.join(consumerDir, "package.json");
    const content = await fsp.readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    
    return !!(
      pkg.dependencies?.[dep] ||
      pkg.devDependencies?.[dep] ||
      pkg.peerDependencies?.[dep] ||
      pkg.optionalDependencies?.[dep]
    );
  } catch {
    return false;
  }
}

/** Extract roots from plan */
function extractRootsFromPlan(plan: DevLinkPlan): string[] {
  const roots = new Set<string>();
  
  for (const pkgMeta of Object.values(plan.index.packages)) {
    if (!pkgMeta.dir) continue;
    const segments = pkgMeta.dir.split(path.sep);
    if (segments.length > 0 && segments[0]) {
      roots.add(segments[0]);
    }
  }
  
  return Array.from(roots);
}

/** Minimal v1 → v2 migration */
function migrateLockV1toV2(oldLock: any): LockFile | null {
  if (!oldLock.packages || typeof oldLock.packages !== 'object') {
    logger.warn("Cannot migrate: invalid v1 structure");
    return null;
  }
  
  // Create synthetic root consumer with all deps
  const rootConsumer: LockConsumer = {
    manifest: "package.json",
    deps: {},
    extends: [],
    overrides: {},
  };
  
  for (const [dep, entry] of Object.entries(oldLock.packages as Record<string, any>)) {
    rootConsumer.deps[dep] = {
      version: entry.version || "latest",
      source: entry.source || "npm",
    };
  }
  
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: oldLock.mode || "local",
    policy: { pin: "caret" },
    consumers: {
      "<root>": rootConsumer,
    },
    meta: {
      format: "per-consumer",
      lockVersion: "2.0.0",
      roots: [],
      reason: "migrated-from-v1",
    },
    updates: {
      lastChecked: null,
      available: {},
    },
  };
}

/** Read existing lock (with v1 migration support) */
async function readLock(lockPath: string): Promise<LockFile | null> {
  try {
    const fileExists = await exists(lockPath);
    if (!fileExists) return null;
    
    const content = await fsp.readFile(lockPath, "utf-8");
    const parsed = JSON.parse(content);
    
    // Handle old format (v1 migration)
    if (!parsed.schemaVersion || !parsed.consumers) {
      logger.info("Detected old lock format, migrating to per-consumer structure");
      return migrateLockV1toV2(parsed);
    }
    
    // Validate structure
    if (!parsed.consumers || typeof parsed.consumers !== 'object') {
      logger.warn("Invalid lock.json structure, ignoring", { path: lockPath });
      return null;
    }
    
    return parsed as LockFile;
  } catch (err) {
    logger.error("Failed to read lock", { err, lockPath });
    return null;
  }
}

/** Extract declared range for dep from a consumer package.json */
async function getDeclaredRange(consumerDir: string, dep: string): Promise<string | undefined> {
  const pkg = await readJsonSafe<any>(join(consumerDir, "package.json"));
  if (!pkg) { return undefined; }
  const sections = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const;
  for (const s of sections) {
    const v = pkg[s]?.[dep];
    if (typeof v === "string" && v.trim()) { return v.trim(); }
  }
  return undefined;
}

/** If value looks like ^1.2.3 or ~1.2.3 or >=1.2.3 <2, try to extract concrete x.y.z */
function extractConcreteVersion(range: string): string | undefined {
  // прямой x.y.z
  const mExact = range.match(/^\d+\.\d+\.\d+(?:[-+].*)?$/);
  if (mExact) { return mExact[0]; }

  // caret/tilde ^1.2.3 / ~1.2.3
  const mCaret = range.match(/^[\^~](\d+\.\d+\.\d+(?:[-+].*)?)$/);
  if (mCaret) { return mCaret[1]; }

  // диапазоны вида >=1.2.3 <2 или 1.2.3 - 1.3.0 — взять левую границу
  const mGte = range.match(/>=\s*(\d+\.\d+\.\d+)/);
  if (mGte) { return mGte[1]; }

  // last option: захват первой подпоследовательности x.y.z
  const mAny = range.match(/(\d+\.\d+\.\d+(?:[-+].*)?)/);
  if (mAny) { return mAny[1]; }

  return undefined;
}

/** Apply pin policy to either a concrete version or a declared range */
function pinVersion(rangeOrVersion: string, pin: "exact" | "caret"): string {
  // если уже конкретная версия
  const concrete = extractConcreteVersion(rangeOrVersion);
  if (concrete) {
    return pin === "caret" ? `^${concrete}` : concrete;
  }

  // если неконкретный диапазон и политика "caret" — оставим как есть (он уже caret/tilde/прочее)
  if (pin === "caret") { return rangeOrVersion; }

  // политика "exact", но диапазон — попытаемся хотя бы выцепить базовую конкретику
  const fallback = extractConcreteVersion(rangeOrVersion);
  return fallback ?? "latest";
}

/**
 * Freeze current plan to lock file.
 * Legacy function - now delegates to freezeToLockMerged with new format.
 */
export async function freezeToLock(
  plan: DevLinkPlan,
  cwd = plan.rootDir
): Promise<void> {
  // Delegate to new implementation
  await freezeToLockMerged(plan, cwd, {
    pin: plan.policy.pin ?? "caret",
    replace: true, // Old behavior was to replace
    prune: false,
    dryRun: false,
  });
}

export interface FreezeMergeOptions {
  replace?: boolean;  // Default false - if true, start fresh
  prune?: boolean;    // Default false - if true, remove entries not in plan
  pin?: "exact" | "caret";  // Don't mutate plan.policy
  dryRun?: boolean;   // Default false - calculate diff without writing
  reason?: string;    // Reason for freeze operation
  initiatedBy?: string; // Who initiated the operation
  command?: string;   // Command that triggered freeze
}

export interface FreezeDryRunResult {
  added: string[];
  updated: string[];
  removed: string[];
}

/**
 * Freeze plan to lock.json with per-consumer deps
 * @param plan - DevLink plan to freeze
 * @param cwd - Working directory
 * @param opts - Merge options (replace, prune, pin, dryRun, reason, initiatedBy, command)
 * @returns FreezeDryRunResult when dryRun = true, otherwise void
 */
export async function freezeToLockMerged(
  plan: DevLinkPlan,
  cwd: string,
  opts: FreezeMergeOptions = {}
): Promise<FreezeDryRunResult | void> {
  const { pin = "caret", dryRun = false, replace = false, prune = false } = opts;
  
  const resolvedRootDir = path.resolve(plan.rootDir);
  const lockPath = path.join(resolvedRootDir, ".kb", "devlink", "lock.json");
  
  // Read existing lock (with v1 migration support)
  const existingLock = await readLock(lockPath);
  
  // Normalize mode to local or remote
  const lockMode: "local" | "remote" = plan.mode === "npm" ? "local" : (plan.mode as "local" | "remote");
  
  // Initialize new lock
  const lockFile: LockFile = replace || !existingLock ? {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    mode: lockMode,
    policy: { pin },
    consumers: {},
    meta: {
      format: "per-consumer",
      lockVersion: "2.0.0",
      roots: extractRootsFromPlan(plan),
      reason: opts.reason || "manual-freeze",
      initiatedBy: opts.initiatedBy || "cli-user",
      command: opts.command ?? undefined,
      createdAt: new Date().toISOString(),
    },
    updates: {
      lastChecked: null,
      available: {},
    },
  } : {
    ...existingLock,
    generatedAt: new Date().toISOString(),
    policy: { pin },
    meta: {
      ...existingLock.meta,
      lockVersion: "2.0.0",
      reason: opts.reason || "manual-freeze",
      initiatedBy: opts.initiatedBy || "cli-user",
      command: opts.command ?? undefined,
      createdAt: new Date().toISOString(),
    },
  };
  
  // For dry-run tracking
  const changes: Record<string, { added: string[]; updated: string[]; removed: string[] }> = {};
  
  // Group actions by consumer
  const actionsByConsumer = new Map<string, typeof plan.actions>();
  for (const action of plan.actions) {
    if (!actionsByConsumer.has(action.target)) {
      actionsByConsumer.set(action.target, []);
    }
    actionsByConsumer.get(action.target)!.push(action);
  }
  
  // Cache for declared versions
  const declaredCache = new Map<string, Record<string, string | undefined>>();
  
  async function getDeclaredCached(consumerDir: string, dep: string): Promise<string | undefined> {
    let map = declaredCache.get(consumerDir);
    if (!map) {
      map = {};
      declaredCache.set(consumerDir, map);
    }
    if (!(dep in map)) {
      map[dep] = await getDeclaredRange(consumerDir, dep);
    }
    return map[dep];
  }
  
  // Process each consumer
  for (const [consumerName, actions] of actionsByConsumer) {
    const consumerMeta = plan.index.packages[consumerName];
    if (!consumerMeta) continue;
    
    const consumerDir = consumerMeta.dir;
    const manifestPath = path.relative(resolvedRootDir, path.join(consumerDir, "package.json"));
    const manifestFullPath = path.join(consumerDir, "package.json");
    
    // Compute checksum
    const checksum = await checksumFile(manifestFullPath);
    
    // Initialize or preserve consumer
    if (!lockFile.consumers[consumerName]) {
      lockFile.consumers[consumerName] = {
        manifest: manifestPath,
        checksum,
        deps: {},
        extends: [],
        overrides: {},
      };
    } else if (!replace) {
      // Keep existing deps if not replacing, but update checksum
      lockFile.consumers[consumerName] = {
        ...lockFile.consumers[consumerName],
        manifest: manifestPath,
        checksum,
      };
    }
    
    const consumer = lockFile.consumers[consumerName];
    const oldDeps = { ...consumer.deps };
    const seenDeps = new Set<string>();
    
    if (dryRun) {
      changes[consumerName] = { added: [], updated: [], removed: [] };
    }
    
    // Process each dependency for this consumer
    for (const action of actions) {
      const dep = action.dep;
      seenDeps.add(dep);
      
      // Get provider metadata
      const providerMeta = plan.index.packages[dep];
      const providerDir = providerMeta?.dir;
      
      // Determine source (Windows-safe)
      let source: LockEntry["source"] = "npm";
      let sourceHint: SourceHint | undefined;
      
      if (providerMeta && providerDir) {
        const relPath = path.relative(resolvedRootDir, path.resolve(providerDir));
        if (!relPath.startsWith("..") && !path.isAbsolute(relPath)) {
          source = "workspace";
          sourceHint = { resolvedFrom: "workspace" };
        } else {
          source = "link";
          sourceHint = { resolvedFrom: "local-link" };
        }
      } else if (dep.startsWith("github:")) {
        source = "github";
        sourceHint = { resolvedFrom: "github" };
      } else {
        sourceHint = {
          resolvedFrom: "pnpm-lock.yaml",
          registry: "https://registry.npmjs.org",
        };
      }
      
      // Get version
      let version: string;
      
      if (source === "workspace" && providerMeta?.version) {
        version = `workspace:*`;
      } else if (source === "link" && providerDir) {
        const linkPath = path.relative(consumerDir, providerDir);
        version = `link:${linkPath}`;
      } else {
        // External packages: resolve and pin
        const declared = await getDeclaredCached(consumerDir, dep);
        let installed: string | undefined;
        
        try {
          installed = resolveInstalledVersionNear(consumerDir, dep);
          if (!installed && plan.rootDir !== consumerDir) {
            installed = resolveInstalledVersionNear(plan.rootDir, dep);
          }
        } catch (err) {
          logger.debug("Failed to resolve installed version", { dep, err });
        }
        
        const base = declared ?? installed ?? "latest";
        version = base === "latest" ? "latest" : pinVersion(base, pin);
      }
      
      // Track changes for dry-run
      if (dryRun) {
        const change = changes[consumerName];
        if (!change) continue; // Should not happen
        
        const oldDep = oldDeps[dep];
        if (!oldDep) {
          change.added.push(dep);
        } else if (oldDep.version !== version || oldDep.source !== source) {
          change.updated.push(dep);
        }
      }
      
      // Write to consumer deps
      consumer.deps[dep] = { version, source, sourceHint };
    }
    
    // Prune unused deps if requested (with safeguard)
    if (prune) {
      const depsToRemove: string[] = [];
      
      for (const dep of Object.keys(consumer.deps)) {
        if (!seenDeps.has(dep)) {
          // Safeguard: only prune if not declared in manifest
          const isDeclared = await isDeclaredInManifest(dep, consumerDir);
          if (!isDeclared) {
            depsToRemove.push(dep);
          }
        }
      }
      
      for (const dep of depsToRemove) {
        if (dryRun) {
          const change = changes[consumerName];
          if (change) {
            change.removed.push(dep);
          }
        }
        delete consumer.deps[dep];
      }
    }
  }
  
  // Dry-run: aggregate and return
  if (dryRun) {
    const totalAdded: string[] = [];
    const totalUpdated: string[] = [];
    const totalRemoved: string[] = [];
    
    for (const [consumer, diff] of Object.entries(changes)) {
      totalAdded.push(...diff.added.map(d => `${consumer}::${d}`));
      totalUpdated.push(...diff.updated.map(d => `${consumer}::${d}`));
      totalRemoved.push(...diff.removed.map(d => `${consumer}::${d}`));
    }
    
    logger.info("[dry-run] Would update lock.json", {
      consumers: Object.keys(changes).length,
      added: totalAdded.length,
      updated: totalUpdated.length,
      removed: totalRemoved.length,
    });
    
    return { added: totalAdded, updated: totalUpdated, removed: totalRemoved };
  }
  
  // Write lock file
  await fsp.mkdir(path.dirname(lockPath), { recursive: true });
  await fsp.writeFile(lockPath, JSON.stringify(lockFile, null, 2), "utf-8");
  
  // Compute final lock hash
  const lockHash = await checksumFile(lockPath);
  lockFile.meta.hash = lockHash;
  
  // Rewrite with hash
  await fsp.writeFile(lockPath, JSON.stringify(lockFile, null, 2), "utf-8");
  
  logger.info("Lock written", {
    path: lockPath,
    consumers: Object.keys(lockFile.consumers).length,
    totalDeps: Object.values(lockFile.consumers).reduce((sum, c) => sum + Object.keys(c.deps).length, 0),
    hash: lockHash,
  });
}