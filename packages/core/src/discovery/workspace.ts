import { promises as fsp } from "fs";
import { join, resolve } from "path";

const IGNORED = new Set([
  "node_modules",
  ".git",
  ".kb",
  ".next",
  "dist",
  "build",
  "coverage",
]);

async function exists(p: string) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function isDir(p: string) {
  try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
}

async function hasFile(dir: string, filename: string) {
  return exists(join(dir, filename));
}

async function hasAnyDir(dir: string, names: string[]) {
  for (const n of names) {
    if (await isDir(join(dir, n))) { return true; }
  }
  return false;
}

/** Simple monorepo detector (packages/* or apps/*) */
export async function isMonorepoRoot(rootAbs: string): Promise<boolean> {
  return hasAnyDir(rootAbs, ["packages", "apps"]);
}

/** Return child directories of base, which have package.json */
export async function findChildRepoRoots(baseAbs: string): Promise<string[]> {
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(baseAbs);
  } catch {
    return [];
  }

  const dirs = entries
    .filter((name) => !name.startsWith(".") && !IGNORED.has(name))
    .map((name) => join(baseAbs, name));

  const out: string[] = [];
  for (const d of dirs) {
    if (!(await isDir(d))) { continue; }
    if (await hasFile(d, "package.json")) { out.push(resolve(d)); }
  }
  return out;
}


/** Detect workspace container roots */
export async function detectWorkspaceContainerRoots(rootAbs: string): Promise<string[]> {
  // 1) is monorepo? → no container
  if (await isMonorepoRoot(rootAbs)) { return []; }

  // 2) has multiple child repos?
  const children = await findChildRepoRoots(rootAbs);
  if (children.length >= 2) {
    return children;
  }

  // 3) not a container
  return [];
}