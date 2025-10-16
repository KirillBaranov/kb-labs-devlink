import { promises as fsp } from "node:fs";
import { join } from "node:path";
import { writeJson } from "../../utils/fs";
import type { DevLinkPlan } from "../types";
import { logger } from "../../utils/logger";
import { resolveInstalledVersionNear } from "../../discovery";

export interface LockEntry {
  version: string;
  source: "npm" | "local";
}

export interface LockFile {
  generatedAt: string;
  mode: string;
  packages: Record<string, LockEntry>;
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
 * Источники версии (по убыванию приоритета):
 *  1) declared range из package.json потребителя;
 *  2) версия workspace-пакета (если dep — локальный пакет);
 *  3) установленная версия возле таргета или у корня;
 *  4) "latest".
 * Дальше применяем pin-политику.
 */
export async function freezeToLock(
  plan: DevLinkPlan,
  cwd = plan.rootDir
): Promise<void> {
  const lockFile: LockFile = {
    generatedAt: new Date().toISOString(),
    mode: plan.mode,
    packages: {},
  };

  // Для ускорения — кэш прочитанных package.json потребителей
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

  for (const action of plan.actions) {
    const dep = action.dep;

    const targetMeta = plan.index.packages[action.target];
    const consumerDir = targetMeta?.dir || plan.rootDir;

    // 1) Попробовать declared range из package.json потребителя
    const resolved: string | undefined = await getDeclaredCached(consumerDir, dep);

    // 2) Если зависимость — локальный пакет, подставить его версию (как "конкретику")
    const wsVersion = plan.index.packages[dep]?.version;

    // 3) Если по-прежнему не ясно, посмотреть установленную версию возле потребителя или у корня
    let installed: string | undefined;
    try {
      installed = resolveInstalledVersionNear(consumerDir, dep);
      if (!installed && plan.rootDir && plan.rootDir !== consumerDir) {
        installed = resolveInstalledVersionNear(plan.rootDir, dep);
      }
    } catch {
      // ignore
    }

    // Выбрать лучший источник:
    // - если есть declaredRange — он первичен (даёт стабильность вне зависимости от node_modules)
    // - иначе если это workspace-пакет — берём точную версию локального пакета
    // - иначе если нашли установленную — берём её
    // - иначе latest
    const base = resolved ?? wsVersion ?? installed ?? "latest";

    // Применить политику пиннинга
    const pinned = base === "latest" ? "latest" : pinVersion(base, plan.policy.pin ?? "caret");

    // Источник фиксируем как npm (ADR-0012)
    lockFile.packages[dep] = {
      version: pinned,
      source: "npm",
    };
  }

  const lockPath = `${cwd}/.kb/devlink/lock.json`;
  await writeJson(lockPath, lockFile);

  logger.info("Lock file created", {
    path: lockPath,
    packages: Object.keys(lockFile.packages).length,
  });
}