import { promises as fsp } from 'fs';
import { join, resolve, dirname } from 'path';
import { exists, repoNameFromPath, pkgJsonPath, walkPatterns } from '../utils/fs';
import { sha1 } from '../utils/hash';
import type { PkgRef, DevlinkState, DepEdge, DepType } from '../types';
import { logger } from '../utils/logger';

export interface DiscoverOptions {
  roots?: string[]; // абсолютные пути корней; если не задано — текущий репо
}

async function tryReadPkg(dirAbs: string): Promise<{ pkg?: any; hash?: string } | null> {
  const p = pkgJsonPath(dirAbs);
  if (!(await exists(p))) { return null; }
  const raw = await (await fsp.readFile(p, 'utf8'));
  const hash = sha1(raw);
  try {
    const pkg = JSON.parse(raw);
    return { pkg, hash };
  } catch {
    return null;
  }
}

async function listDirImmediate(p: string) {
  try {
    const ents = await fsp.readdir(p, { withFileTypes: true });
    return ents.filter(e => e.isDirectory()).map(e => join(p, e.name));
  } catch {
    return [];
  }
}

async function subRepoRoots(rootAbs: string): Promise<string[]> {
  try {
    const ents = await fsp.readdir(rootAbs, { withFileTypes: true });
    const dirs = ents.filter(e => e.isDirectory()).map(e => join(rootAbs, e.name));
    const out: string[] = [];
    for (const d of dirs) {
      const pj = pkgJsonPath(d);
      if (await exists(pj)) {
        out.push(resolve(d));
      }
    }
    return out;
  } catch {
    return [];
  }
}

async function collectPackagesInRoot(rootAbs: string): Promise<{
  pkgs: PkgRef[];
  hashes: Record<string, string>;
  deps: DepEdge[];
}> {
  const repo = repoNameFromPath(rootAbs);
  const buckets = walkPatterns(rootAbs);

  const pkgs: PkgRef[] = [];
  const hashes: Record<string, string> = {};
  const deps: DepEdge[] = [];

  // root
  const rootMeta = await tryReadPkg(rootAbs);
  if (rootMeta?.pkg) {
    const { name, version, private: isPrivate } = rootMeta.pkg;
    if (name && version) {
      pkgs.push({
        name,
        version,
        pathAbs: resolve(rootAbs),
        repo: repo!,
        private: !!isPrivate,
        workspace: false,
      });
      hashes[resolve(rootAbs)] = rootMeta.hash!;
      collectDeps(deps, rootMeta.pkg, name);
    }
  }

  // packages/* and apps/*
  for (const bucket of buckets.slice(1)) {
    const children = await listDirImmediate(bucket);
    for (const dir of children) {
      const meta = await tryReadPkg(dir);
      if (!meta?.pkg) { continue; }
      const { name, version, private: isPrivate } = meta.pkg;
      if (!name || !version) { continue; }
      pkgs.push({
        name,
        version,
        pathAbs: resolve(dir),
        repo: repo!,
        private: !!isPrivate,
        workspace: true,
      });
      hashes[resolve(dir)] = meta.hash!;
      collectDeps(deps, meta.pkg, name);
    }
  }

  return { pkgs, hashes, deps };
}

function collectDeps(out: DepEdge[], pkg: any, fromName: string) {
  const add = (block: any, type: DepType) => {
    if (!block || typeof block !== 'object') { return; }
    for (const toName of Object.keys(block)) {
      out.push({ from: fromName, to: toName, type });
    }
  };
  add(pkg.dependencies, 'prod');
  add(pkg.devDependencies, 'dev');
  add(pkg.peerDependencies, 'peer');
}

export async function discover(options: DiscoverOptions = {}): Promise<DevlinkState> {
  const rootAbs = resolve(process.cwd());
  const roots = options.roots?.length ? options.roots.map(r => resolve(r)) : [rootAbs];

  // Auto-discover sibling repos if no explicit roots and no buckets under current root
  if (!options.roots?.length) {
    // buckets: packages/*, apps/*
    const buckets = walkPatterns(rootAbs).slice(1);
    let hasBucketChildren = false;
    for (const b of buckets) {
      const children = await listDirImmediate(b);
      if (children.length) {
        hasBucketChildren = true;
        break;
      }
    }
    if (!hasBucketChildren) {
      // Look for sibling repos at parent level
      const parentDir = dirname(rootAbs);
      const siblings = await subRepoRoots(parentDir);
      if (siblings.length) {
        // add, de-dup, keep root first
        const seen = new Set(roots.map(r => resolve(r)));
        for (const s of siblings) {
          if (!seen.has(s)) {
            roots.push(s);
            seen.add(s);
          }
        }
        logger.info('auto-discovered additional roots', { count: siblings.length });
      }
    }
  }

  const pkgsAll: PkgRef[] = [];
  const hashes: Record<string, string> = {};
  const depsAll: DepEdge[] = [];

  for (const root of roots) {
    const res = await collectPackagesInRoot(resolve(root));
    pkgsAll.push(...res.pkgs);
    Object.assign(hashes, res.hashes);
    depsAll.push(...res.deps);
  }

  // de-dup by name: prefer the one whose path starts with current cwd
  const cwd = resolve(process.cwd());
  const byName = new Map<string, PkgRef>();
  for (const p of pkgsAll) {
    const existing = byName.get(p.name);
    if (!existing) {
      byName.set(p.name, p);
      continue;
    }
    const preferCurrent = p.pathAbs.startsWith(cwd) && !existing.pathAbs.startsWith(cwd);
    if (preferCurrent) { byName.set(p.name, p); }
  }

  const packages = Array.from(byName.values());

  const state: DevlinkState = {
    devlinkVersion: '0.1.0',
    generatedAt: new Date().toISOString(),
    packages,
    deps: depsAll,
    hashes,
  };

  logger.info('discovered packages', { count: packages.length, deps: depsAll.length });
  return state;
}