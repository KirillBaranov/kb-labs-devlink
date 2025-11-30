import type { PackageJson } from 'packages/devlink-core/src/types';
export type DevLinkMode = "local" | "npm" | "workspace" | "auto";

export interface ScanOptions {
  rootDir: string;
  include?: string[];     // glob-include (опц.)
  exclude?: string[];     // glob-exclude (опц.)
  roots?: string[];
  container?: boolean;    // treat rootDir as container and scan child repos
}

export interface PackageRef {
  manifest: Record<string, any>;
  name: string;
  version: string;
  dir: string;            // абсолютный путь
  rootDir?: string;       // корневая директория репозитория (для определения same-repo)
  private?: boolean;
  pkg: PackageJson;
}

export interface PackageIndex {
  rootDir: string;
  packages: Record<string, PackageRef>; // key = package name
  byDir: Record<string, PackageRef>;    // key = abs dir
}

export interface GraphEdge {
  from: string; // package name
  to: string;   // package name
  type: "dep" | "peer" | "dev";
}

export interface PackageGraph {
  nodes: string[];          // package names
  edges: GraphEdge[];
  topological: string[];    // topo order (без циклов)
  cycles: string[][];       // список циклов (если есть)
}

export interface DevLinkPolicy {
  allow?: string[];         // allow link
  deny?: string[];          // deny link
  pin?: "exact" | "caret";  // версия пиннинга
  prerelease?: "allow" | "block"; // политика для prerelease версий
  upgrade?: "none" | "patch" | "minor" | "major"; // политика обновления
  forceLocal?: string[];    // всегда линковать локально
  forceNpm?: string[];      // всегда брать из npm
}

export type ManifestPatch = {
  manifestPath: string;  // abs path to consumer's package.json
  consumerName: string;  // package name for resolveDepSection
  section?: "dependencies" | "devDependencies" | "peerDependencies";
  depName: string;       // "@kb-labs/cli-core"
  from?: string;         // old value (for undo)
  to: string;            // "link:../relative/path"
};

export type LinkActionKind =
  | "link-local"        // mode=local → link: (not for peers); mode=yalc → yalc; workspace → workspace: or link:
  | "unlink"
  | "use-npm"           // заменить на npm-версию
  | "use-workspace";    // поставить workspace-линк (внутри репо)

export interface LinkAction {
  target: string;           // куда применяем (consumer)
  dep: string;              // что подключаем/меняем (provider)
  kind: LinkActionKind;
  reason?: string;
  from?: string;            // текущее значение (before) для дебага
  to?: string;              // новое значение (after) для дебага
}

export interface BuildPlanOptions {
  mode: DevLinkMode;
  strict?: boolean;         // упасть, если cycles
  policy?: DevLinkPolicy;   // из policy-модуля/конфига
}

export interface DevLinkPlan {
  rootDir: string;
  mode: DevLinkMode;
  actions: LinkAction[];
  graph: PackageGraph;
  index: PackageIndex;
  policy: DevLinkPolicy;
  diagnostics: string[];
}

export interface ApplyOptions {
  dryRun?: boolean;
  logLevel?: "silent" | "info" | "debug";
  concurrency?: number;
  preflightCancelled?: boolean; // To hide "No operations to apply" message
  backupDir?: string;  // Path to backup directory for undo
}

export interface ApplyResult {
  ok: boolean;
  executed: LinkAction[];
  skipped: LinkAction[];
  errors: { action: LinkAction; error: unknown }[];
  needsInstall: boolean;
  manifestPatches?: ManifestPatch[];
}