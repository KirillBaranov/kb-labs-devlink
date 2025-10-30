import type { PackageIndex, PackageGraph, ScanOptions } from "../types";
import { discover } from "../../discovery";
import { logger } from "../../utils/logger";
import type { DepEdge, DevlinkState } from "../../types";
import { join } from "path";
import { promises as fsp } from "fs";

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
    // Find and display cycle details
    const cycleEdges = findCycleEdges(cycles, edges);
    logger.warn(`Dependency cycles detected`, cycles);
    if (cycleEdges.length > 0) {
      const cyclePath = cycleEdges.map(e => `${e.from} -> ${e.to}`).join(' -> ');
      logger.warn(`Cycle path: ${cyclePath}`);
    }
  }

  return {
    nodes,
    edges,
    cycles: hasCycles ? [cycles] : [],
    topological: sorted,
  };
}

/**
 * Find edges that form a cycle from nodes in the cycle
 */
function findCycleEdges(cycleNodes: string[], edges: Array<{ from: string; to: string }>): Array<{ from: string; to: string }> {
  if (cycleNodes.length === 0) return [];
  
  // Build adjacency map
  const adjMap = new Map<string, string[]>();
  for (const edge of edges) {
    if (cycleNodes.includes(edge.from) && cycleNodes.includes(edge.to)) {
      if (!adjMap.has(edge.from)) adjMap.set(edge.from, []);
      adjMap.get(edge.from)!.push(edge.to);
    }
  }
  
  // Try to find a cycle starting from each node
  for (const startNode of cycleNodes) {
    const visited = new Set<string>();
    const path: string[] = [];
    
    function dfs(node: string): string[] | null {
      if (node === startNode && path.length > 0) {
        return [...path];
      }
      if (visited.has(node)) return null;
      
      visited.add(node);
      path.push(node);
      
      const neighbors = adjMap.get(node) || [];
      for (const neighbor of neighbors) {
        const result = dfs(neighbor);
        if (result) return result;
      }
      
      path.pop();
      return null;
    }
    
    const cycle = dfs(startNode);
    if (cycle && cycle.length > 0) {
      // Convert path to edges
      const cycleEdges: Array<{ from: string; to: string }> = [];
      for (let i = 0; i < cycle.length; i++) {
        const from = cycle[i];
        const to = cycle[(i + 1) % cycle.length];
        if (from && to) {
          cycleEdges.push({ from, to });
        }
      }
      return cycleEdges;
    }
  }
  
  return [];
}

/**
 * Build a package index for quick access
 */
async function buildIndex(state: DevlinkState, rootDir: string, allRoots?: string[]): Promise<PackageIndex> {
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

  // Helper to find rootDir for a package based on its repo field
  function findRootDirByRepo(pkg: any): string {
    // If we have multiple roots, try to determine the actual repo root by looking at the package's repo field
    if (roots && roots.length > 1) {
      const repoName = pkg.repo;
      if (repoName) {
        for (const r of roots) {
          const rootName = r.split('/').pop();
          if (rootName === repoName) {
            return r;
          }
        }
      }
    }
    
    // Fallback: try to find by path
    return findRootDir(pkg.pathAbs);
  }

  // Debug: log roots and package info
  if (roots && roots.length > 1) {
    logger.info('Multiple roots detected', { roots, rootDir });
  }

  // Load manifest data for each package
  for (const pkg of state.packages) {
    const pkgRootDir = findRootDirByRepo(pkg);
    
    // Read package.json to get current dependencies
    let manifest: any = {};
    try {
      const packageJsonPath = join(pkg.pathAbs, 'package.json');
      const content = await fsp.readFile(packageJsonPath, 'utf8');
      manifest = JSON.parse(content);
    } catch (err) {
      // If read fails, manifest remains empty
    }
    
    const ref = {
      manifest,
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
  const index = await buildIndex(state, indexRootDir, roots);

  logger.info(`Scan complete`, {
    packages: Object.keys(index.packages).length,
    edges: graph.edges.length,
    cycles: graph.cycles.length,
  });

  return { state, index, graph };
}