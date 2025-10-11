import { mergePolicy } from "../../policy";
import type {
  BuildPlanOptions,
  DevLinkPlan,
  DevLinkPolicy,
  LinkAction,
  PackageGraph,
  PackageIndex,
} from "../types";

export async function buildPlan(
  index: PackageIndex,
  graph: PackageGraph,
  options: BuildPlanOptions
): Promise<DevLinkPlan> {
  const policy: DevLinkPolicy = await mergePolicy(index.rootDir, options.policy);

  const diagnostics: string[] = [];
  if (graph.cycles.length > 0) {
    diagnostics.push(`Dependency cycles detected: ${graph.cycles.length} cycle(s)`);
    if (options.strict) {
      throw new Error(`Dependency cycles detected in strict mode: ${JSON.stringify(graph.cycles)}`);
    }
  }

  const actionsMap = new Map<string, LinkAction>();
  const skipped: Array<{ consumer: string; provider: string; reason: string }> = [];

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
      action = {
        target: consumer,
        dep: provider,
        kind: "use-npm",
        reason: "forceNpm policy",
      };
    }
    // forceLocal next
    else if (policy.forceLocal?.includes(provider)) {
      if (providerLocal) {
        action = {
          target: consumer,
          dep: provider,
          kind: "link-local",
          reason: "forceLocal policy",
        };
      } else {
        skipped.push({ consumer, provider, reason: "forceLocal but not available locally" });
        diagnostics.push(`Cannot force-local ${provider}: not found locally`);
        continue;
      }
    }
    // mode === "local"
    else if (options.mode === "local") {
      if (providerLocal) {
        action = {
          target: consumer,
          dep: provider,
          kind: "link-local",
          reason: "mode=local",
        };
      } else {
        action = {
          target: consumer,
          dep: provider,
          kind: "use-npm",
          reason: "mode=local but provider not local, fallback to npm",
        };
      }
    }
    // mode === "workspace"
    else if (options.mode === "workspace") {
      if (providerLocal) {
        action = {
          target: consumer,
          dep: provider,
          kind: "use-workspace",
          reason: "mode=workspace",
        };
      } else {
        action = {
          target: consumer,
          dep: provider,
          kind: "use-npm",
          reason: "mode=workspace but provider not local, fallback to npm",
        };
      }
    }
    // mode === "npm"
    else {
      action = {
        target: consumer,
        dep: provider,
        kind: "use-npm",
        reason: "mode=npm",
      };
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