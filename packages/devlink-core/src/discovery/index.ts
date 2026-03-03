import { readFileSync, existsSync, readdirSync } from 'fs';
import { resolve, join, relative, dirname } from 'path';
import yaml from 'js-yaml';
import type { PackageMap, PackageEntry, DevlinkMode } from '@kb-labs/devlink-contracts';
import { filterPublishedPackages } from '../npm/index.js';

interface PnpmWorkspace {
  packages?: string[];
}

interface PackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/** Monorepo info discovered on disk */
export interface MonorepoInfo {
  /** Dir name e.g. kb-labs-core */
  name: string;
  /** Absolute path to the monorepo root */
  rootPath: string;
  /** All package.json paths within the monorepo */
  packagePaths: string[];
  /** pnpm-workspace.yaml content */
  workspacePackages: string[];
}

/**
 * Discovers all kb-labs-* submodule monorepos from the root pnpm-workspace.yaml.
 */
export function discoverMonorepos(rootDir: string): MonorepoInfo[] {
  const workspaceFile = join(rootDir, 'pnpm-workspace.yaml');
  if (!existsSync(workspaceFile)) {
    throw new Error(`pnpm-workspace.yaml not found at ${workspaceFile}`);
  }

  const workspace = yaml.load(readFileSync(workspaceFile, 'utf-8')) as PnpmWorkspace;
  const patterns = workspace.packages ?? [];

  const monorepos: MonorepoInfo[] = [];

  for (const pattern of patterns) {
    const globbed = resolveWorkspacePattern(rootDir, pattern);
    for (const repoPath of globbed) {
      const repoName = repoPath.split('/').pop() ?? repoPath;
      // Only include submodule repos that have their own pnpm-workspace.yaml
      if (!existsSync(join(repoPath, 'pnpm-workspace.yaml'))) {continue;}

      const packagePaths = findPackageJsonFiles(repoPath);
      const repoWorkspace = yaml.load(
        readFileSync(join(repoPath, 'pnpm-workspace.yaml'), 'utf-8')
      ) as PnpmWorkspace;

      monorepos.push({
        name: repoName,
        rootPath: repoPath,
        packagePaths,
        workspacePackages: repoWorkspace.packages ?? [],
      });
    }
  }

  return monorepos;
}

/**
 * Builds a PackageMap: packageName → { linkPath, npmVersion, monorepo }.
 * Scans all packages in all monorepos and collects their name/version.
 *
 * linkPath is relative to the root kb-labs/ dir (so it can be used as link:../path).
 */
export function buildPackageMap(monorepos: MonorepoInfo[], rootDir: string): PackageMap {
  const map: PackageMap = {};

  for (const monorepo of monorepos) {
    for (const pkgPath of monorepo.packagePaths) {
      if (!existsSync(pkgPath)) {continue;}

      let pkg: PackageJson;
      try {
        pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
      } catch {
        continue;
      }

      if (!pkg.name || !pkg.version) {continue;}
      // Only include @kb-labs/* packages
      if (!pkg.name.startsWith('@kb-labs/')) {continue;}
      // Skip private packages — they're not published to npm
      if (pkg.private) {continue;}

      const pkgDir = dirname(pkgPath);
      // Relative path from rootDir to the package dir
      const linkPath = relative(rootDir, pkgDir);

      const entry: PackageEntry = {
        name: pkg.name,
        linkPath,
        npmVersion: `^${pkg.version}`,
        monorepo: monorepo.name,
      };

      map[pkg.name] = entry;
    }
  }

  return map;
}

/**
 * Async version of buildPackageMap that verifies each package exists on npm.
 * For 'local' mode skips the npm check and returns all packages found on disk.
 * For 'npm'/'auto'/undefined filters out packages not published to the registry.
 */
export async function buildPackageMapFiltered(
  monorepos: MonorepoInfo[],
  rootDir: string,
  ttlMs?: number,
  mode?: DevlinkMode
): Promise<PackageMap> {
  const rawMap = buildPackageMap(monorepos, rootDir);
  // local mode: disk has priority, no npm check needed
  if (mode === 'local') {return rawMap;}
  const packageNames = Object.keys(rawMap);
  const published = await filterPublishedPackages(packageNames, ttlMs);
  const filtered: PackageMap = {};
  for (const name of packageNames) {
    if (published.has(name)) {filtered[name] = rawMap[name]!;}
  }
  return filtered;
}

/**
 * Determines the current linking mode of cross-repo dependencies in a package.json.
 * Returns counts of link:, npm, workspace: references for @kb-labs/* deps.
 */
export function analyzePackageDeps(
  pkgPath: string,
  packageMap: PackageMap
): { linkCount: number; npmCount: number; workspaceCount: number; unknownCount: number } {
  let linkCount = 0;
  let npmCount = 0;
  let workspaceCount = 0;
  let unknownCount = 0;

  if (!existsSync(pkgPath)) {return { linkCount, npmCount, workspaceCount, unknownCount };}

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as PackageJson;
  } catch {
    return { linkCount, npmCount, workspaceCount, unknownCount };
  }

  const sections = [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies];
  for (const section of sections) {
    if (!section) {continue;}
    for (const [depName, depValue] of Object.entries(section)) {
      if (!packageMap[depName]) {continue;} // Not a cross-repo dep
      if (depValue.startsWith('link:')) {
        linkCount++;
      } else if (depValue.startsWith('workspace:')) {
        workspaceCount++;
      } else if (depValue.startsWith('^') || depValue.startsWith('~') || /^\d/.test(depValue)) {
        npmCount++;
      } else {
        unknownCount++;
      }
    }
  }

  return { linkCount, npmCount, workspaceCount, unknownCount };
}

/**
 * Finds all package.json files within a monorepo (excludes node_modules, dist).
 */
function findPackageJsonFiles(repoRoot: string): string[] {
  const results: string[] = [];

  function walk(dir: string, depth = 0) {
    if (depth > 4) {return;}

    let entries: import('fs').Dirent<string>[];
    try {
      entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf-8' });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {continue;}
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.name === 'package.json') {
        results.push(full);
      }
    }
  }

  walk(repoRoot);
  return results;
}

/**
 * Resolves a pnpm workspace pattern to actual directory paths.
 * Handles simple names and glob patterns like "kb-labs-*".
 */
function resolveWorkspacePattern(rootDir: string, pattern: string): string[] {
  if (pattern.includes('*') || pattern.includes('?')) {
    const prefix = pattern.replace(/\*.*$/, '');
    try {
      const entries = readdirSync(rootDir, { withFileTypes: true, encoding: 'utf-8' });
      return entries
        .filter(e => e.isDirectory() && e.name.startsWith(prefix))
        .map(e => join(rootDir, e.name));
    } catch {
      return [];
    }
  }

  // Direct path
  const full = resolve(rootDir, pattern);
  return existsSync(full) ? [full] : [];
}
