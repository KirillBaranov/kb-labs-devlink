import type { PackageIndex, PackageGraph, ScanOptions } from "../types";
import { discover } from "../../discovery";
import { logger } from "../../utils/logger";
import type { DepEdge, DevlinkState } from "../../types";

/**
 * Build a dependency graph from DevlinkState
 */
function buildGraph(state: DevlinkState): PackageGraph {
  const nodes = state.packages.map((p) => p.name);
  const edges = state.deps.map((d: DepEdge) => ({
    from: d.from,
    to: d.to,
    type: (d.type === "prod" ? "dep" : d.type) as "dep" | "peer" | "dev",
  }));

  // simple cycle detector (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const node of nodes) { inDegree.set(node, 0); }
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
  }

  const queue: string[] = [];
  inDegree.forEach((count, node) => {
    if (count === 0) { queue.push(node); }
  });

  const sorted: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const edge of edges.filter((e) => e.from === node)) {
      const next = edge.to;
      const newVal = (inDegree.get(next) || 0) - 1;
      inDegree.set(next, newVal);
      if (newVal === 0) { queue.push(next); }
    }
  }

  const cycles = nodes.filter((n) => !sorted.includes(n));
  const hasCycles = cycles.length > 0;
  if (hasCycles) {
    logger.warn(`Dependency cycles detected`, cycles);
  }

  return {
    nodes,
    edges,
    cycles: hasCycles ? [cycles] : [],
    topological: sorted,
  };
}

/**
 * Build a package index for quick access
 */
function buildIndex(state: DevlinkState, rootDir: string, allRoots?: string[]): PackageIndex {
  const packages: Record<string, any> = {};
  const byDir: Record<string, any> = {};

  // Build a map of repo -> rootDir from state packages
  // We'll determine rootDir by finding which root contains each package's path
  const roots = allRoots || [rootDir];
  
  // Helper to find rootDir for a package path
  function findRootDir(pkgPath: string): string {
    // Find the root that contains this path
    for (const r of roots) {
      if (pkgPath.startsWith(r)) {
        return r;
      }
    }
    // Fallback: try to determine from repo name or use rootDir
    // For same-repo detection, we can also group by repo field
    return rootDir;
  }

  for (const pkg of state.packages) {
    const pkgRootDir = findRootDir(pkg.pathAbs);
    const ref = {
      manifest: {},
      name: pkg.name,
      version: pkg.version,
      dir: pkg.pathAbs,
      rootDir: pkgRootDir,
      private: pkg.private,
      pkg: { name: pkg.name, version: pkg.version },
    };
    packages[pkg.name] = ref;
    byDir[pkg.pathAbs] = ref;
  }

  return {
    rootDir,
    packages,
    byDir,
  };
}

/**
 * Full scanning pipeline:
 * 1. Discover packages & dependencies (supports multi-root)
 * 2. Build dependency graph
 * 3. Build index
 *
 * Note: `ScanOptions` in types may not have `roots` yet.
 * We read it defensively via `(opts as any).roots`.
 */
export async function scanPackages(opts: ScanOptions): Promise<{
  state: DevlinkState;
  index: PackageIndex;
  graph: PackageGraph;
}> {
  const { rootDir } = opts;
  const roots = ((opts as any).roots as string[] | undefined)?.filter(Boolean);

  logger.info(
    roots?.length
      ? `Scanning multiple roots`
      : `Scanning workspace: ${rootDir}`,
    roots?.length ? { roots } : { rootDir },
  );

  // discovery already supports multi-root aggregation with de-dup
  const state = await discover(roots?.length ? { roots } : {});

  const graph = buildGraph(state);
  // choose first root as index root (for deterministic behavior)
  const indexRootDir = roots?.length ? roots[0]! : rootDir;
  const index = buildIndex(state, indexRootDir, roots?.length ? roots : undefined);

  logger.info(`Scan complete`, {
    packages: Object.keys(index.packages).length,
    edges: graph.edges.length,
    cycles: graph.cycles.length,
  });

  return { state, index, graph };
}