import { promises as fsp } from 'fs';
import { dirname, join, resolve } from 'path';

export async function readJson<T = any>(p: string): Promise<T> {
  const buf = await fsp.readFile(p, 'utf8');
  return JSON.parse(buf) as T;
}

export async function writeJson(p: string, data: unknown) {
  await fsp.mkdir(dirname(p), { recursive: true });
  await fsp.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function exists(p: string) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export function abs(p: string) {
  return resolve(p);
}

export function repoNameFromPath(rootAbs: string) {
  // last segment as repo name
  const segs = rootAbs.replace(/[/\\]+$/, '').split(/[/\\]/);
  return segs[segs.length - 1];
}

export function pkgJsonPath(dirAbs: string) {
  return join(dirAbs, 'package.json');
}

export function walkPatterns(rootAbs: string) {
  // by convention: root package, packages/*, apps/*
  return [
    rootAbs,
    join(rootAbs, 'packages'),
    join(rootAbs, 'apps'),
  ];
}