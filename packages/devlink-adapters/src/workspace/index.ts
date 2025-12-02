/**
 * @module @kb-labs/devlink-adapters/workspace
 * Workspace resolution utilities
 */

import { resolve } from 'node:path';

export interface ResolveWorkspaceRootOptions {
  cwd?: string;
  startDir?: string;
}

export interface WorkspaceResolution {
  rootDir: string;
}

/**
 * Resolve workspace root directory
 *
 * @param options - Resolution options
 * @returns Workspace resolution result with rootDir
 */
export async function resolveWorkspaceRoot(
  options: ResolveWorkspaceRootOptions
): Promise<WorkspaceResolution> {
  const rootDir = resolve(options.cwd || options.startDir || process.cwd());
  return { rootDir };
}
