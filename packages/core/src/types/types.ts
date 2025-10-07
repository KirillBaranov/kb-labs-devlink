export type DepType = 'prod' | 'dev' | 'peer';

export interface PkgRef {
  name: string;
  version: string;
  pathAbs: string;
  repo: string;        // имя репозитория/корня
  private?: boolean;
  workspace?: boolean; // лежит ли в packages/* или apps/*
}

export interface DepEdge {
  from: string; // package name
  to: string;   // package name
  type: DepType;
}

export interface DevlinkState {
  devlinkVersion: string;
  generatedAt: string; // ISO
  packages: PkgRef[];
  deps: DepEdge[];
  hashes: Record<string, string>; // pathAbs -> sha1(package.json)
}

export type SourceMode = 'auto' | 'local' | 'npm';

export interface VersionPolicy {
  pin: 'exact' | 'range';
  upgrade: 'none' | 'patch' | 'minor';
  prerelease: 'allow' | 'block';
}

export interface PlanEntry {
  name: string;
  fromVersion: string | null;
  toVersion: string;
  source: 'local' | 'npm';
  reason: string;
  pathAbs?: string;
}

export interface PlanSnapshot {
  policy: {
    mode: SourceMode;
    pin: VersionPolicy['pin'];
    upgrade: VersionPolicy['upgrade'];
    prerelease: VersionPolicy['prerelease'];
  };
  entries: PlanEntry[];
  computedAt: string;
}

export interface LockSnapshot {
  // name -> { version, source }
  [name: string]: { version: string; source: 'npm' | 'local' };
}