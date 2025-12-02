import { getLogger } from '@kb-labs/core-sys/logging';
import { mergePolicy } from '../models/policy/policy';
import type {
  BuildPlanOptions,
  DevLinkPlan,
  DevLinkPolicy,
  LinkAction,
  PackageGraph,
  PackageIndex,
} from "../types";

const logger = getLogger('devlink:plan');

export async function buildPlan(
  index: PackageIndex,
  graph: PackageGraph,
  options: BuildPlanOptions
): Promise<DevLinkPlan> {
  const policy: DevLinkPolicy = await mergePolicy(index.rootDir, options.policy);

  logger.debug('Building plan with policy', { policy });

  const diagnostics: string[] = [];
  if (graph.cycles.length > 0) {
    diagnostics.push(`Dependency cycles detected: ${graph.cycles.length} cycle(s)`);
    if (options.strict) {
      throw new Error(`Dependency cycles detected in strict mode: ${JSON.stringify(graph.cycles)}`);
    }
  }

  const actionsMap = new Map<string, LinkAction>();
  const skipped: Array<{ consumer: string; provider: string; reason: string }> = [];
  
  /**
   * Helper to create LinkAction with current version tracking
   */
  const createAction = (
    target: string,
    dep: string,
    kind: LinkAction["kind"],
    reason: string,
    newVersion?: string
  ): LinkAction => {
    const consumerPkg = index.packages[target];
    let currentVersion: string | undefined;
    
    if (consumerPkg?.manifest) {
      currentVersion = consumerPkg.manifest.dependencies?.[dep] ||
                      consumerPkg.manifest.devDependencies?.[dep] ||
                      consumerPkg.manifest.peerDependencies?.[dep];
    }
    
    // For use-npm, get version from provider package if not specified
    let effectiveNewVersion = newVersion;
    if (!effectiveNewVersion && kind === "use-npm") {
      const providerPkg = index.packages[dep];
      // For workspace packages, use version from index
      // For external packages, keep currentVersion if it exists (probably a range like ^1.0.0)
      effectiveNewVersion = providerPkg?.version || currentVersion;
    }
    
    const action: LinkAction = {
      target,
      dep,
      kind,
      reason,
      from: currentVersion,
      to: effectiveNewVersion,
    };
    
    return action;
  };

  for (const edge of graph.edges) {
    const consumer = edge.from;
    const provider = edge.to;
    const providerLocal = !!index.packages[provider];
    const consumerLocal = !!index.packages[consumer];

    // Skip self-dependencies
    if (consumer === provider) {
      continue;
    }

    // Generate unique key for deduplication
    const key = `${consumer}::${provider}`;
    if (actionsMap.has(key)) {
      continue; // Already processed this dependency
    }
    // Check if provider is denied by policy
    if (policy.deny?.includes(provider)) {
      skipped.push({ consumer, provider, reason: "denied by policy" });
      diagnostics.push(`Skipped ${provider} in ${consumer}: denied by policy`);
      continue;
    }

    // Check if allow list is specified and provider is not in it
    if (policy.allow && policy.allow.length > 0 && !policy.allow.includes(provider)) {
      skipped.push({ consumer, provider, reason: "not in allow list" });
      diagnostics.push(`Skipped ${provider} in ${consumer}: not in allow list`);
      continue;
    }

    // Determine the action based on policy and mode
    let action: LinkAction | null = null;

    // forceNpm takes precedence
    if (policy.forceNpm?.includes(provider)) {
      action = createAction(consumer, provider, "use-npm", "forceNpm policy");
    }
    // forceLocal next
    else if (policy.forceLocal?.includes(provider)) {
      if (providerLocal) {
        action = createAction(consumer, provider, "link-local", "forceLocal policy");
      } else {
        skipped.push({ consumer, provider, reason: "forceLocal but not available locally" });
        diagnostics.push(`Cannot force-local ${provider}: not found locally`);
        continue;
      }
    }
    // mode === "local"
    else if (options.mode === "local") {
      if (providerLocal) {
        action = createAction(consumer, provider, "link-local", "mode=local");
      } else {
        action = createAction(consumer, provider, "use-npm", "mode=local but provider not local, fallback to npm");
      }
    }
    // mode === "workspace"
    else if (options.mode === "workspace") {
      if (providerLocal) {
        action = createAction(consumer, provider, "use-workspace", "mode=workspace", "workspace:*");
      } else {
        action = createAction(consumer, provider, "use-npm", "mode=workspace but provider not local, fallback to npm");
      }
    }
    // mode === "auto"
    else if (options.mode === "auto") {
      if (providerLocal) {
        // Determine: same rootDir (monorepo) or different repos
        const consumerPkg = index.packages[consumer];
        const providerPkg = index.packages[provider];
        const consumerRootDir = consumerPkg?.rootDir;
        const providerRootDir = providerPkg?.rootDir;
        
        const sameRepo = consumerRootDir && providerRootDir && consumerRootDir === providerRootDir;
        const kind = sameRepo ? "use-workspace" : "link-local";
        const reason = sameRepo ? "auto: same monorepo → workspace" : "auto: cross-repo → link";
        
        action = createAction(consumer, provider, kind, reason, sameRepo ? "workspace:*" : undefined);
      } else {
        action = createAction(consumer, provider, "use-npm", "auto: external → npm");
      }
    }
    // mode === "npm" (default fallback)
    else {
      action = createAction(consumer, provider, "use-npm", "mode=npm");
    }

    if (action) {
      actionsMap.set(key, action);
    }
  }

  // Convert map to array and sort deterministically
  const actions = Array.from(actionsMap.values()).sort((a, b) => {
    // Sort by target, then dep, then kind
    if (a.target !== b.target) {
      return a.target.localeCompare(b.target);
    }
    if (a.dep !== b.dep) {
      return a.dep.localeCompare(b.dep);
    }
    return a.kind.localeCompare(b.kind);
  });

  if (skipped.length > 0) {
    diagnostics.push(`Total skipped: ${skipped.length} dependencies`);
  }

  return {
    rootDir: index.rootDir,
    mode: options.mode,
    actions,
    graph,
    index,
    policy,
    diagnostics,
  };
}