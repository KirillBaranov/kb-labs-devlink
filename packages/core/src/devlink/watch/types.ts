import type { PackageRef, PackageIndex, PackageGraph } from "../types";

export type WatchMode = "local" | "yalc" | "auto";

export interface WatchOptions {
  rootDir: string;
  mode?: WatchMode;
  providers?: string[]; // glob patterns to filter providers
  consumers?: string[]; // glob patterns to filter consumers
  debounce?: number; // debounce window in ms (default 200)
  concurrency?: number; // max parallel builds (default 4)
  noBuild?: boolean; // skip build, only refresh
  exitOnError?: boolean; // exit on first error
  notify?: boolean; // system notifications (reserved for future)
  dryRun?: boolean; // show what would be watched, don't start
  json?: boolean; // JSON output mode
}

export interface WatchState {
  mode: WatchMode;
  providers: Map<string, ProviderConfig>; // provider name -> config
  consumers: Map<string, ConsumerConfig>; // consumer name -> config
  graph: PackageGraph;
  index: PackageIndex;
  inFlightBuilds: Set<string>; // provider names currently building
  lastBuildStartTime: Map<string, number>; // provider name -> timestamp
  lastBuildEndTime: Map<string, number>; // provider name -> timestamp
}

export interface ProviderConfig {
  name: string;
  dir: string;
  buildCommand: string;
  watchPaths: string[]; // paths to watch relative to dir
  pkg: PackageRef;
}

export interface ConsumerConfig {
  name: string;
  dir: string;
  hasRefreshScript: boolean;
  pkg: PackageRef;
}

export type WatchEventType =
  | "started"
  | "ready"
  | "changed"
  | "building"
  | "built"
  | "build-error"
  | "refreshing"
  | "refreshed"
  | "refresh-error"
  | "error"
  | "stopped";

export interface WatchEvent {
  type: WatchEventType;
  ts: string; // ISO timestamp
  pkg?: string; // package name
  files?: string[]; // changed files (relative paths)
  command?: string; // build command
  duration?: number; // in milliseconds
  consumers?: string[]; // consumer package names
  error?: string;
  mode?: WatchMode;
  providers?: number;
  consumersCount?: number;
}

export interface DryRunResult {
  mode: WatchMode;
  providers: Array<{
    name: string;
    dir: string;
    buildCommand: string;
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

