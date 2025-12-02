import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { DevLinkPolicy } from '../types';
import type { DevlinkState, PlanEntry, PlanSnapshot, SourceMode, VersionPolicy, LockSnapshot } from '../types';
import { logger } from '@kb-labs/devlink-adapters/logging';

export type { DevLinkPolicy as DevLinkPolicyType } from "../types";

/**
 * Базовые значения политики на случай, если файл/override не заданы
 */
const DEFAULT_POLICY: DevLinkPolicy = {
  allow: [],
  deny: [],
  forceLocal: [],
  forceNpm: [],
  pin: "caret",           // или 'exact' — зависит от твоей схемы
  prerelease: "allow",    // 'allow' | 'block'
  upgrade: "none",        // 'none' | 'patch' | 'minor' | 'major'
};

/**
 * Безопасное чтение JSON (без падений при отсутствии/битом файле)
 */
function readJsonSafe<T = unknown>(absPath: string): T | null {
  try {
    const raw = readFileSync(absPath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Слить массивы с дедупликацией и фильтрацией пустых
 */
function mergeStrArrays(a?: string[], b?: string[]): string[] {
  const out = new Set<string>();
  (a ?? []).forEach((x) => x && out.add(x));
  (b ?? []).forEach((x) => x && out.add(x));
  return Array.from(out);
}

/**
 * Нормализуем и сливаем поля политики
 */
function mergeObjects(base: DevLinkPolicy, over?: Partial<DevLinkPolicy>): DevLinkPolicy {
  if (!over) {return base;}

  return {
    allow: mergeStrArrays(base.allow, over.allow),
    deny: mergeStrArrays(base.deny, over.deny),
    forceLocal: mergeStrArrays(base.forceLocal, over.forceLocal),
    forceNpm: mergeStrArrays(base.forceNpm, over.forceNpm),
    pin: over.pin ?? base.pin,
    prerelease: over.prerelease ?? base.prerelease,
    upgrade: over.upgrade ?? base.upgrade,
  };
}

/**
 * mergePolicy:
 * 1) берет DEFAULT_POLICY
 * 2) опционально подмешивает содержимое файла `.kb/devlink.policy.json` в корне репозитория
 * 3) сверху накладывает явные overrides из опций команды
 */
export async function mergePolicy(
  repoRoot: string,
  override?: Partial<DevLinkPolicy>
): Promise<DevLinkPolicy> {
  // 1. default
  let result = { ...DEFAULT_POLICY };

  // 2. файл политики (опционально)
  const fileCandidates = [
    join(repoRoot, ".kb", "devlink.policy.json"),
    join(repoRoot, "devlink.policy.json"),
  ];
  for (const p of fileCandidates) {
    if (existsSync(p)) {
      const filePolicy = readJsonSafe<Partial<DevLinkPolicy>>(p);
      if (filePolicy) {
        result = mergeObjects(result, filePolicy);
        break;
      }
    }
  }

  // 3. overrides из CLI/опций
  result = mergeObjects(result, override);

  return result;
}


// В этом MVP считаем, что "локальная сборка" доступна,
// если пакет присутствует в state (т.е. локально найден)
// и пользователь хочет local/auto.
function localBuildAvailable(state: DevlinkState, name: string): boolean { return state.packages.some(p => p.name === name); }

function pinVersion(version: string, pin: VersionPolicy['pin']): string { if (pin === 'exact') { return version; } const m = version.match(/^(\d+)\.(\d+)\.(\d+)/); if (!m) { return version; } return `^${m[1]}.${m[2]}.${m[3]}`; }

export function computePlan(
  state: DevlinkState,
  mode: SourceMode,
  policy: VersionPolicy,
  installedVersions?: Record<string, string>, // опционально
): PlanSnapshot {
  const entries: PlanEntry[] = [];

  for (const pkg of state.packages) {
    const wantLocal =
      mode === 'local' ||
      (mode === 'auto' && localBuildAvailable(state, pkg.name));

    const src: 'local' | 'npm' = wantLocal ? 'local' : 'npm';
    // если есть карта установленных версий — ориентируемся на неё как fromVersion
    const fromVersion = installedVersions?.[pkg.name] ?? null;
    const toVersion = pinVersion(pkg.version, policy.pin);

    // prerelease policy (грубая проверка)
    const isPre = /-(alpha|beta|rc|next)\./i.test(pkg.version);
    if (isPre && policy.prerelease === 'block' && src === 'npm') {
      logger.warn('prerelease blocked by policy', { name: pkg.name, version: pkg.version });
      continue;
    }

    entries.push({
      name: pkg.name,
      fromVersion,
      toVersion,
      source: src,
      reason: wantLocal ? 'local available' : 'fallback to npm',
      pathAbs: pkg.pathAbs,
    });
  }

  return {
    policy: { mode, pin: policy.pin, upgrade: policy.upgrade, prerelease: policy.prerelease },
    entries,
    computedAt: new Date().toISOString(),
  };
}

export function freezePlanToLock(plan: PlanSnapshot): LockSnapshot {
  const lock: LockSnapshot = {};
  for (const e of plan.entries) {
    // freeze всегда npm, согласно ADR-0012
    lock[e.name] = { version: e.toVersion, source: 'npm' };
  }
  return lock;
}