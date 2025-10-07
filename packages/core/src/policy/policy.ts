import type { DevlinkState, PlanEntry, PlanSnapshot, SourceMode, VersionPolicy, LockSnapshot } from './types';
import { logger } from './logger';

// В этом MVP считаем, что "локальная сборка" доступна,
// если пакет присутствует в state (т.е. локально найден)
// и пользователь хочет local/auto.
function localBuildAvailable(state: DevlinkState, name: string): boolean {
  return state.packages.some(p => p.name === name);
}

function pinVersion(version: string, pin: VersionPolicy['pin']): string {
  if (pin === 'exact') { return version; }
  // range — грубо нормализуем к ^major.minor.patch
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) { return version; }
  return `^${m[1]}.${m[2]}.${m[3]}`;
}

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

export function freezeToLock(plan: PlanSnapshot): LockSnapshot {
  const lock: LockSnapshot = {};
  for (const e of plan.entries) {
    // freeze всегда npm, согласно ADR-0012
    lock[e.name] = { version: e.toVersion, source: 'npm' };
  }
  return lock;
}