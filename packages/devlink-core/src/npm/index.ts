import { execSync } from 'child_process';
import { useCache } from '@kb-labs/sdk';

/** Default TTL: 24 hours */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Checks if a package exists on the npm registry.
 * Results are cached via useCache() with the given TTL.
 */
export async function isPublishedOnNpm(
  packageName: string,
  ttlMs = DEFAULT_TTL_MS
): Promise<boolean> {
  const cacheKey = `devlink:npm-exists:${packageName}`;
  const cache = useCache();

  if (cache) {
    const cached = await cache.get<boolean>(cacheKey);
    if (cached !== undefined && cached !== null) {return cached;}
  }

  let exists: boolean;
  try {
    execSync(`npm view ${packageName} version --json`, {
      stdio: 'pipe',
      timeout: 10_000,
    });
    exists = true;
  } catch {
    exists = false;
  }

  if (cache) {
    await cache.set(cacheKey, exists, ttlMs);
  }

  return exists;
}

/**
 * Filters a list of package names to only those published on npm.
 * Runs checks concurrently.
 */
export async function filterPublishedPackages(
  packageNames: string[],
  ttlMs = DEFAULT_TTL_MS
): Promise<Set<string>> {
  const results = await Promise.all(
    packageNames.map(async name => ({
      name,
      published: await isPublishedOnNpm(name, ttlMs),
    }))
  );

  return new Set(results.filter(r => r.published).map(r => r.name));
}
