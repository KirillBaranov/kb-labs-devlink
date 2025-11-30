import { promises as fsp } from 'fs';
import { join, resolve, dirname } from 'path';
import { createRequire } from 'module';
import { exists, repoNameFromPath, pkgJsonPath, walkPatterns } from '../filesystem/fs';
import { sha1 } from '../utils/hash';
import type { PkgRef, DevlinkState, DepEdge, DepType } from '../types';
import { logger } from '../logging/logger';
import {
  detectWorkspaceContainerRoots,
  isMonorepoRoot,
  findChildRepoRoots,
} from './workspace';

export interface DiscoverOptions {
  roots?: string[]; // абсолютные пути корней; если не задано — авто
  forceContainer?: boolean; // treat cwd as container and include child repos
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

/**
 * Resolve the actually installed version of a package as found from a given rootDir.
 * This does not perform any network calls; it inspects the nearest node_modules by resolution.
 * Returns "latest" when the package cannot be resolved from that root.
 */
export async function resolveInstalledVersionNear(rootDir: string, pkgName: string): Promise<string> {
  try {
    // Bind a require to the provided rootDir
    // Using createRequire ensures resolution semantics from that folder.
    const req = createRequire(join(rootDir, 'package.json'));
    const pkgJsonPath = req.resolve(`${pkgName}/package.json`);
    // Read synchronously to avoid changing outer async signatures
    const { readFileSync } = await import('fs');
    const raw = readFileSync(pkgJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed?.version === 'string' ? parsed.version : 'latest';
  } catch {
    return 'latest';
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
  // БАЗОВЫЙ корень — текущая cwd
  const cwdRoot = resolve(process.cwd());

  // 1) Явно указанные roots имеют высший приоритет
  let roots: string[] = [];
  if (options.roots && options.roots.length > 0) {
    roots = options.roots.map((r) => resolve(r));
  }

  if (roots.length === 0) {
    if (options.forceContainer) {
      const children = await findChildRepoRoots(cwdRoot);
      if (children.length > 0) {
        const dedup = new Set<string>([cwdRoot, ...children]);
        roots = Array.from(dedup);
        logger.info('force-container enabled', {
          container: cwdRoot,
          children: children.length,
        });
      } else {
        roots = [cwdRoot];
      }
    } else {
    // 2) Попробовать распознать «контейнер воркспейса»
    const containerChildren = await detectWorkspaceContainerRoots(cwdRoot);
    if (containerChildren.length >= 2) {
      logger.info('workspace-container detected', { 
        container: cwdRoot, 
        children: containerChildren.length,
          repos: containerChildren.map((r) => r.split('/').pop()),
      });
      roots = containerChildren;
    } else {
      // 3) Обычный сценарий: работаем с текущим репозиторием как с одиночным root
      roots = [cwdRoot];

      // 4) (СОХРАНЯЕМ ПОВЕДЕНИЕ) — если это одиночный репо, попробуем найти «соседние» репозитории на уровне родителя
      //    но только если мы не в монорепо (чтобы не мешать локальному монорепо-воркфлоу)
      if (!(await isMonorepoRoot(cwdRoot))) {
        const parent = dirname(cwdRoot);
          const siblings = (await findChildRepoRoots(parent)).filter(
            (p) => p !== cwdRoot,
          );
        if (siblings.length > 0) {
          logger.info('sibling repos auto-discovered', { count: siblings.length });
          roots = Array.from(new Set([cwdRoot, ...siblings]));
          }
        }
      }
    }
  }

  // Далее — как раньше: собираем пакеты по roots
  const pkgsAll: PkgRef[] = [];
  const hashes: Record<string, string> = {};
  const depsAll: DepEdge[] = [];

  for (const root of roots) {
    const res = await collectPackagesInRoot(resolve(root));
    pkgsAll.push(...res.pkgs);
    Object.assign(hashes, res.hashes);
    depsAll.push(...res.deps);
  }

  // de-dup by name: предпочитаем тот, что лежит ближе к cwd
  const byName = new Map<string, PkgRef>();
  for (const p of pkgsAll) {
    const existing = byName.get(p.name);
    if (!existing) {
      byName.set(p.name, p);
      continue;
    }
    const preferCurrent = p.pathAbs.startsWith(cwdRoot) && !existing.pathAbs.startsWith(cwdRoot);
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

  logger.info('discovered packages', { 
    count: packages.length, 
    deps: depsAll.length, 
    roots: roots.length,
    rootNames: roots.map(r => r.split('/').pop())
  });
  return state;
}