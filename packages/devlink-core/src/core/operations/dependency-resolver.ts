import { logger } from '@kb-labs/devlink-adapters/logging';
import type { PackageGraph, PackageIndex } from "../types";

/**
 * Build reverse dependency map (provider -> consumers)
 * Returns map of provider name to array of consumer names
 */
export function buildReverseDependencyMap(
  graph: PackageGraph,
  index: PackageIndex
): Map<string, string[]> {
  const reverseMap = new Map<string, string[]>();

  // Initialize with empty arrays for all packages
  for (const pkgName of Object.keys(index.packages)) {
    reverseMap.set(pkgName, []);
  }

  // Build reverse edges: if A depends on B, then B's consumers include A
  for (const edge of graph.edges) {
    const provider = edge.to; // dependency (provider)
    const consumer = edge.from; // package that depends on it (consumer)

    if (!reverseMap.has(provider)) {
      reverseMap.set(provider, []);
    }

    const consumers = reverseMap.get(provider)!;
    if (!consumers.includes(consumer)) {
      consumers.push(consumer);
    }
  }

  logger.debug("Reverse dependency map built", {
    totalProviders: reverseMap.size,
    providersWithConsumers: Array.from(reverseMap.entries()).filter(
      ([, consumers]) => consumers.length > 0
    ).length,
  });

  return reverseMap;
}

/**
 * Get direct consumers for a provider
 * Returns array of consumer package names
 */
export function getDirectConsumers(
  providerName: string,
  reverseDepMap: Map<string, string[]>
): string[] {
  const consumers = reverseDepMap.get(providerName) || [];
  logger.debug("Direct consumers retrieved", { 
    provider: providerName, 
    consumers: consumers.length 
  });
  return consumers;
}

/**
 * Filter packages by glob patterns
 * Returns true if package name matches any of the patterns
 */
export function matchesGlobPatterns(
  packageName: string,
  patterns: string[] | undefined
): boolean {
  if (!patterns || patterns.length === 0) {
    return true; // no filter, match all
  }

  for (const pattern of patterns) {
    // Simple glob matching: * matches any characters
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    if (regex.test(packageName)) {
      return true;
    }
  }

  return false;
}

/**
 * Filter providers based on glob patterns
 */
export function filterProviders(
  packages: string[],
  patterns: string[] | undefined
): string[] {
  const filtered = packages.filter((pkg) => matchesGlobPatterns(pkg, patterns));
  
  if (patterns && patterns.length > 0) {
    logger.info("Providers filtered", {
      total: packages.length,
      filtered: filtered.length,
      patterns,
    });
  }

  return filtered;
}

/**
 * Filter consumers based on glob patterns
 */
export function filterConsumers(
  consumers: string[],
  patterns: string[] | undefined
): string[] {
  const filtered = consumers.filter((pkg) => matchesGlobPatterns(pkg, patterns));
  
  if (patterns && patterns.length > 0) {
    logger.debug("Consumers filtered", {
      total: consumers.length,
      filtered: filtered.length,
      patterns,
    });
  }

  return filtered;
}

