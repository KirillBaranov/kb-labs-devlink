import type { PackageRef, PackageIndex, PackageGraph } from "../types";

export type WatchMode = "local" | "yalc" | "auto";

export interface WatchOptions {
  rootDir: string;
  mode?: WatchMode;
  providers?: string[];
  consumers?: string[];
  
  // Основные опции
  perPackageDebounceMs?: number; // 150-250, default 200
  globalConcurrency?: number; // default 5
  buildTimeoutMs?: number; // default 60000
  strictPreflight?: boolean; // exit 1 на SKIP
  profile?: number; // интервал профилирования в мс
  
  // Служебные
  dryRun?: boolean;
  json?: boolean; // line-delimited JSON
  exitOnError?: boolean;
  
  // @deprecated (не используются в v2)
  debounce?: number;
  concurrency?: number;
  noBuild?: boolean;
  notify?: boolean;
}

export interface WatchState {
  mode: WatchMode;
  providers: Map<string, ProviderConfig>;
  consumers: Map<string, ConsumerConfig>;
  graph: PackageGraph;
  index: PackageIndex;
  reverseDeps: Map<string, string[]>;
}

export interface ProviderConfig {
  name: string;
  dir: string;
  buildCommand: string | null;
  devCommand: string | null; // scripts.dev
  watchPaths: string[];
  pkg: PackageRef;
  
  // Новое
  timeoutMs: number; // с учетом override
  consumerCount: number; // для priority
}

export interface ConsumerConfig {
  name: string;
  dir: string;
  hasRefreshScript: boolean;
  pkg: PackageRef;
}

export interface DryRunResult {
  mode: WatchMode;
  providers: Array<{
    name: string;
    dir: string;
    buildCommand: string | null;
    devCommand: string | null;
    watchPaths: string[];
  }>;
  consumers: Array<{
    name: string;
    dir: string;
    hasRefreshScript: boolean;
  }>;
  dependencies: Array<{
    provider: string;
    consumers: string[];
  }>;
}

