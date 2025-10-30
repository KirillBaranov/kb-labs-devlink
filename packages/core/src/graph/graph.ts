import type { PackageIndex, PackageGraph, GraphEdge } from "../devlink/types";

/**
 * Достаём имена зависимостей из manifest'а пакета.
 * MVP: берём dependencies/devDependencies/peerDependencies, без version-матчинга.
 */
function extractDepNames(manifest: any): string[] {
  const deps = {
    ...(manifest?.dependencies ?? {}),
    ...(manifest?.devDependencies ?? {}),
    ...(manifest?.peerDependencies ?? {}),
  };
  return Object.keys(deps);
}

/**
 * DFS детектор циклов. Возвращает массив циклов (как пути имён).
 */
function detectCycles(nodes: string[], edges: GraphEdge[]): string[][] {
  const adj = new Map<string, string[]>();
  nodes.forEach(n => adj.set(n, []));
  edges.forEach(e => {
    if (adj.has(e.from)) {adj.get(e.from)!.push(e.to);}
  });

  const visited = new Set<string>();
  const stack = new Set<string>();
  const cycles: string[][] = [];
  const path: string[] = [];

  function dfs(u: string) {
    visited.add(u);
    stack.add(u);
    path.push(u);

    for (const v of adj.get(u)!) {
      if (!visited.has(v)) {
        dfs(v);
      } else if (stack.has(v)) {
        // цикл: берём хвост от v до u
        const start = path.indexOf(v);
        if (start >= 0) {cycles.push(path.slice(start));}
      }
    }

    stack.delete(u);
    path.pop();
  }

  for (const n of nodes) {
    if (!visited.has(n)) {dfs(n);}
  }
  return cycles;
}

/**
 * Топологическая сортировка (Kahn). Если есть циклы — вернём частичный порядок.
 */
function topoOrder(nodes: string[], edges: GraphEdge[]): string[] {
  const inDeg = new Map<string, number>(nodes.map(n => [n, 0]));
  edges.forEach(e => inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1));

  const q: string[] = [];
  inDeg.forEach((deg, n) => { if (deg === 0) {q.push(n);} });

  const res: string[] = [];
  while (q.length) {
    const u = q.shift()!;
    res.push(u);
    for (const e of edges) {
      if (e.from === u) {
        const d = (inDeg.get(e.to) ?? 0) - 1;
        inDeg.set(e.to, d);
        if (d === 0) {q.push(e.to);}
      }
    }
  }
  return res; // при циклах часть узлов не попадёт — это ок для MVP
}

/** Исходящие рёбра для узла */
export function outgoing(graph: PackageGraph, name: string) {
  return graph.edges.filter(e => e.from === name);
}

/** Входящие рёбра для узла */
export function incoming(graph: PackageGraph, name: string) {
  return graph.edges.filter(e => e.to === name);
}

/**
 * Построение графа из PackageIndex.
 * nodes: имена пакетов из index
 * edges: from(consumer) → to(provider), только если provider есть в index
 */
export function buildGraph(index: PackageIndex): PackageGraph {
  const nodes = Object.keys(index.packages); // имена пакетов
  const pkgByName = index.packages;

  const edges: GraphEdge[] = [];

  for (const [name, meta] of Object.entries(pkgByName)) {
    const manifest = meta.manifest ?? {};
    const depNames = extractDepNames(manifest);

    for (const dep of depNames) {
      if (pkgByName[dep]) {
        edges.push({
          from: name,
          to: dep,
          type: "dep",
        });
      }
    }
  }
  return { nodes, edges, topological: topoOrder(nodes, edges), cycles: detectCycles(nodes, edges) };
}