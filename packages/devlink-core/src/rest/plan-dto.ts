import { promises as fsp } from 'fs';
import { basename, join, relative } from 'path';
import { sha1 } from '../utils/hash';
import type { DevLinkPlan, GraphEdge, LinkAction } from '../core/operations/types';

const DEFAULT_PLAN_PATH = join('.kb', 'devlink', 'last-plan.json');

type LinkActionKind = LinkAction['kind'];
type EdgeType = GraphEdge['type'];

type ActionsByKind = Partial<Record<LinkActionKind, number>>;
type EdgesByType = Record<EdgeType, number>;

interface InfoPanelSection {
  title: string;
  data: unknown;
  format?: 'json' | 'text' | 'keyvalue';
  collapsible?: boolean;
}

interface InfoPanelData {
  sections: InfoPanelSection[];
}

interface CardData {
  title: string;
  content: string;
  status?: 'ok' | 'warn' | 'error' | 'info';
  icon?: string;
  meta?: Record<string, unknown>;
}

interface CardListData {
  cards: CardData[];
}

export interface PlanNodeDTO {
  id: string;
  version?: string;
  repo?: string | null;
  dir?: string | null;
  relativeDir?: string | null;
  workspace: boolean;
  actionCounts: {
    total: number;
    byKind: Record<LinkActionKind, number>;
  };
  dependencyCounts: {
    incoming: number;
    outgoing: number;
    incomingByType: EdgesByType;
    outgoingByType: EdgesByType;
  };
  hasLocalPackage: boolean;
}

export interface PlanEdgeDTO {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  action?: {
    kind: LinkActionKind;
    reason?: string;
    from?: string;
    to?: string;
  };
}

export interface PlanSummaryDTO {
  rootDir: string;
  mode: DevLinkPlan['mode'];
  packageCount: number;
  actionCount: number;
  actionsByKind: Record<LinkActionKind, number>;
  cycleCount: number;
  diagnosticsCount: number;
}

export interface PlanMetaDTO {
  sourcePath: string;
  hash: string;
  lastModified: string | null;
  generatedAt: string;
}

export interface DevLinkPlanDTO {
  nodes: PlanNodeDTO[];
  edges: PlanEdgeDTO[];
  cycles: string[][];
  summary: PlanSummaryDTO;
  diagnostics: string[];
  meta: PlanMetaDTO;
  widgets: PlanWidgetsDTO;
}

export interface LoadPlanOptions {
  /** Override path to last-plan.json (absolute). */
  planPath?: string;
}

interface CachedPlan {
  hash: string;
  dto: DevLinkPlanDTO;
  sourcePath: string;
  mtimeMs: number;
  size: number;
}

let cachedPlan: CachedPlan | null = null;

export interface ChartSeriesDTO {
  name: string;
  points: Array<{
    x: string | number;
    y: number;
  }>;
}

export interface TreeNodeDTO {
  id: string;
  label: string;
  icon?: string;
  children?: TreeNodeDTO[];
}

export interface DependencyTableRow {
  package: string;
  repo: string;
  version: string;
  scope: string;
  actions: number;
  actionKinds: string;
  outgoingDeps: number;
  incomingDeps: number;
}

export interface PlanWidgetsDTO {
  overview: {
    infoPanel: InfoPanelData;
    actionsChart: ChartSeriesDTO[];
    diagnostics: CardListData;
  };
  dependencies: {
    repoTree: TreeNodeDTO;
    packagesTable: DependencyTableRow[];
  };
}

function createEdgeCounters(): EdgesByType {
  return { dep: 0, dev: 0, peer: 0 };
}

function incrementByKind(target: Record<LinkActionKind, number>, kind: LinkActionKind | undefined) {
  if (!kind) {
    return;
  }
  target[kind] = (target[kind] ?? 0) + 1;
}

function incrementByType(target: EdgesByType, type: EdgeType) {
  target[type] += 1;
}

function buildNodeDTO(
  nodeId: string,
  plan: DevLinkPlan,
  outgoingEdges: GraphEdge[],
  incomingEdges: GraphEdge[],
  actionsForNode: LinkAction[]
): PlanNodeDTO {
  const pkgRef = plan.index?.packages?.[nodeId];
  const dir = pkgRef?.dir ?? null;
  const repo = pkgRef?.rootDir ? basename(pkgRef.rootDir) : null;
  const relativeDir = dir && plan.rootDir ? relative(plan.rootDir, dir) : null;
  const workspace = Boolean(pkgRef?.rootDir && pkgRef.rootDir === plan.rootDir);

  const actionCounts: Record<LinkActionKind, number> = {} as Record<LinkActionKind, number>;
  for (const action of actionsForNode) {
    incrementByKind(actionCounts, action.kind);
  }

  const outgoingByType = createEdgeCounters();
  const incomingByType = createEdgeCounters();

  for (const edge of outgoingEdges) {
    incrementByType(outgoingByType, edge.type);
  }
  for (const edge of incomingEdges) {
    incrementByType(incomingByType, edge.type);
  }

  return {
    id: nodeId,
    version: pkgRef?.version,
    repo,
    dir,
    relativeDir,
    workspace,
    actionCounts: {
      total: actionsForNode.length,
      byKind: actionCounts,
    },
    dependencyCounts: {
      incoming: incomingEdges.length,
      outgoing: outgoingEdges.length,
      incomingByType,
      outgoingByType,
    },
    hasLocalPackage: Boolean(pkgRef),
  };
}

function buildEdgeDTO(edge: GraphEdge, actionMap: Map<string, LinkAction>): PlanEdgeDTO {
  const action = actionMap.get(`${edge.from}::${edge.to}`);
  return {
    id: `${edge.from}->${edge.to}`,
    from: edge.from,
    to: edge.to,
    type: edge.type,
    action: action
      ? {
          kind: action.kind,
          reason: action.reason,
          from: action.from,
          to: action.to,
        }
      : undefined,
  };
}

function buildSummary(plan: DevLinkPlan, actionsByKind: Record<LinkActionKind, number>): PlanSummaryDTO {
  return {
    rootDir: plan.rootDir,
    mode: plan.mode,
    packageCount: plan.graph.nodes.length,
    actionCount: plan.actions.length,
    actionsByKind,
    cycleCount: plan.graph.cycles.length,
    diagnosticsCount: plan.diagnostics.length,
  };
}

function buildInfoPanel(
  summary: PlanSummaryDTO,
  meta: PlanMetaDTO,
  nodes: PlanNodeDTO[]
): InfoPanelData {
  const workspacePackages = nodes.filter((node) => node.workspace).length;
  const externalPackages = nodes.length - workspacePackages;

  return {
    sections: [
      {
        title: 'Summary',
        format: 'keyvalue',
        collapsible: false,
        data: {
          packages: summary.packageCount,
          actions: summary.actionCount,
          diagnostics: summary.diagnosticsCount,
          cycles: summary.cycleCount,
        },
      },
      {
        title: 'Mode & Source',
        format: 'keyvalue',
        data: {
          mode: summary.mode,
          rootDir: summary.rootDir,
          planFile: meta.sourcePath,
          generatedAt: meta.generatedAt,
          lastModified: meta.lastModified ?? 'n/a',
        },
      },
      {
        title: 'Action Breakdown',
        format: 'json',
        data: summary.actionsByKind,
        collapsible: true,
      },
      {
        title: 'Package Scope',
        format: 'keyvalue',
        data: {
          workspace: workspacePackages,
          external: externalPackages,
        },
        collapsible: true,
      },
    ],
  };
}

function buildActionsChart(actionsByKind: Record<LinkActionKind, number>): ChartSeriesDTO[] {
  const points = Object.entries(actionsByKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => ({
      x: kind,
      y: count,
    }));

  return [
    {
      name: 'Actions',
      points,
    },
  ];
}

function buildDiagnosticsCards(plan: DevLinkPlan, summary: PlanSummaryDTO): CardListData {
  const cards: CardListData['cards'] = [];

  if (summary.cycleCount > 0) {
    cards.push({
      title: 'Dependency cycles detected',
      content: `Plan contains ${summary.cycleCount} cycle(s).`,
      status: 'error',
      icon: 'alert',
    });
  }

  if (plan.diagnostics.length > 0) {
    plan.diagnostics.forEach((message, index) => {
      cards.push({
        title: `Diagnostic #${index + 1}`,
        content: message,
        status: 'warn',
      });
    });
  }

  if (cards.length === 0) {
    cards.push({
      title: 'All clear',
      content: 'No diagnostics reported for the latest DevLink plan.',
      status: 'ok',
      icon: 'check',
    });
  }

  return { cards };
}

function buildRepoTree(plan: DevLinkPlan, nodes: PlanNodeDTO[]): TreeNodeDTO {
  const rootLabel = basename(plan.rootDir) || plan.rootDir || 'workspace';
  const root: TreeNodeDTO = {
    id: `repo:${rootLabel}`,
    label: rootLabel,
    children: [],
  };

  if (nodes.length === 0) {
    root.children = [
      {
        id: 'repo:empty',
        label: 'No packages discovered in the current plan.',
      },
    ];
    return root;
  }

  const repoMap = new Map<string, TreeNodeDTO>();

  const getRepoNode = (repoName: string): TreeNodeDTO => {
    if (!repoMap.has(repoName)) {
      const node: TreeNodeDTO = {
        id: `repo:${repoName}`,
        label: repoName,
        children: [],
      };
      repoMap.set(repoName, node);
      root.children!.push(node);
    }
    return repoMap.get(repoName)!;
  };

  for (const node of nodes) {
    const repoName = node.workspace
      ? 'Workspace'
      : node.repo ?? 'External';
    const repoNode = getRepoNode(repoName);
    repoNode.children = repoNode.children ?? [];
    repoNode.children.push({
      id: `pkg:${node.id}`,
      label: `${node.id}${node.version ? `@${node.version}` : ''} • deps ${node.dependencyCounts.outgoing} • actions ${node.actionCounts.total}`,
    });
  }

  // Sort repos and packages alphabetically for determinism
  root.children = root.children
    ?.sort((a, b) => a.label.localeCompare(b.label))
    .map((repoNode) => ({
      ...repoNode,
      children: repoNode.children?.sort((a, b) => a.label.localeCompare(b.label)),
    }));

  return root;
}

function buildPackagesTable(nodes: PlanNodeDTO[]): DependencyTableRow[] {
  return nodes
    .map((node) => {
      const actionKindEntries = Object.entries(node.actionCounts.byKind).filter(([, value]) => value > 0);
      const actionKinds =
        actionKindEntries.length > 0
          ? actionKindEntries.map(([kind, value]) => `${kind} ×${value}`).join(', ')
          : '—';

      return {
        package: node.id,
        repo: node.repo ?? 'external',
        version: node.version ?? 'n/a',
        scope: node.workspace ? 'workspace' : 'external',
        actions: node.actionCounts.total,
        actionKinds,
        outgoingDeps: node.dependencyCounts.outgoing,
        incomingDeps: node.dependencyCounts.incoming,
      };
    })
    .sort((a, b) => a.package.localeCompare(b.package));
}

export async function loadPlanDTO(rootDir: string, options: LoadPlanOptions = {}): Promise<DevLinkPlanDTO> {
  const planPath = options.planPath ?? join(rootDir, DEFAULT_PLAN_PATH);

  const stats = await fsp.stat(planPath);
  const mtimeMs = stats.mtimeMs;
  const size = stats.size;

  if (
    cachedPlan &&
    cachedPlan.sourcePath === planPath &&
    cachedPlan.mtimeMs === mtimeMs &&
    cachedPlan.size === size
  ) {
    return cachedPlan.dto;
  }

  const fileContent = await fsp.readFile(planPath, 'utf8');
  const hash = sha1(fileContent);

  if (
    cachedPlan &&
    cachedPlan.sourcePath === planPath &&
    cachedPlan.hash === hash
  ) {
    // Update metadata if only mtime/size changed (e.g., touch) but content same
    cachedPlan.mtimeMs = mtimeMs;
    cachedPlan.size = size;
    cachedPlan.dto.meta.lastModified = stats.mtime.toISOString();
    cachedPlan.dto.meta.generatedAt = new Date().toISOString();
    return cachedPlan.dto;
  }

  const plan = JSON.parse(fileContent) as DevLinkPlan;

  const actionMap = new Map<string, LinkAction>();
  const actionsByKind: Record<LinkActionKind, number> = {} as Record<LinkActionKind, number>;

  for (const action of plan.actions) {
    actionMap.set(`${action.target}::${action.dep}`, action);
    incrementByKind(actionsByKind, action.kind);
  }

  const outgoingMap = new Map<string, GraphEdge[]>();
  const incomingMap = new Map<string, GraphEdge[]>();

  for (const edge of plan.graph.edges) {
    if (!outgoingMap.has(edge.from)) {
      outgoingMap.set(edge.from, []);
    }
    outgoingMap.get(edge.from)!.push(edge);

    if (!incomingMap.has(edge.to)) {
      incomingMap.set(edge.to, []);
    }
    incomingMap.get(edge.to)!.push(edge);
  }

  const actionsByTarget = new Map<string, LinkAction[]>();
  for (const action of plan.actions) {
    if (!actionsByTarget.has(action.target)) {
      actionsByTarget.set(action.target, []);
    }
    actionsByTarget.get(action.target)!.push(action);
  }

  const nodes: PlanNodeDTO[] = plan.graph.nodes.map((nodeId) =>
    buildNodeDTO(
      nodeId,
      plan,
      outgoingMap.get(nodeId) ?? [],
      incomingMap.get(nodeId) ?? [],
      actionsByTarget.get(nodeId) ?? []
    )
  );

  const edges: PlanEdgeDTO[] = plan.graph.edges.map((edge) => buildEdgeDTO(edge, actionMap));

  const summary = buildSummary(plan, actionsByKind);

  const meta: PlanMetaDTO = {
    sourcePath: planPath,
    hash,
    lastModified: stats.mtime.toISOString(),
    generatedAt: new Date().toISOString(),
  };

  const widgets: PlanWidgetsDTO = {
    overview: {
      infoPanel: buildInfoPanel(summary, meta, nodes),
      actionsChart: buildActionsChart(actionsByKind),
      diagnostics: buildDiagnosticsCards(plan, summary),
    },
    dependencies: {
      repoTree: buildRepoTree(plan, nodes),
      packagesTable: buildPackagesTable(nodes),
    },
  };

  const dto: DevLinkPlanDTO = {
    nodes,
    edges,
    cycles: plan.graph.cycles,
    summary,
    diagnostics: plan.diagnostics,
    meta,
    widgets,
  };

  cachedPlan = {
    hash,
    dto,
    sourcePath: planPath,
    mtimeMs,
    size,
  };

  return dto;
}

export function clearPlanDtoCache(): void {
  cachedPlan = null;
}
