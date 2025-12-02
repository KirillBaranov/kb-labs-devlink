/**
 * Artifact detection utilities for DevLink
 * Detects stale yalc artifacts, protocol conflicts, and other issues
 */

import { promises as fsp } from 'fs';
import { join } from 'path';
import { exists } from '../filesystem/fs';
// Note: glob is imported dynamically to avoid build issues
import { logger } from '../logging/logger';

export interface StaleArtifacts {
  yalc: string[];
  conflicts: Array<{
    package: string;
    protocols: string[];
  }>;
}

export interface ProtocolConflict {
  package: string;
  protocols: string[];
  manifest: string;
  sections: string[];
}

/**
 * Detect stale yalc artifacts in the workspace
 */
export async function findYalcArtifacts(rootDir: string): Promise<string[]> {
  const artifacts: string[] = [];
  
  // Check root level
  if (await exists(join(rootDir, 'yalc.lock'))) {
    artifacts.push('yalc.lock');
  }
  if (await exists(join(rootDir, '.yalc'))) {
    artifacts.push('.yalc');
  }
  
  // Check packages
  const packagesGlobs = ['packages/*', 'apps/*'];
  for (const pattern of packagesGlobs) {
    try {
      const { glob } = await import('glob');
      const pkgs = await glob(pattern, { cwd: rootDir });
      for (const pkg of pkgs) {
        const yalcDir = join(rootDir, pkg, '.yalc');
        const yalcLock = join(rootDir, pkg, 'yalc.lock');
        
        if (await exists(yalcDir)) {
          artifacts.push(`${pkg}/.yalc`);
        }
        if (await exists(yalcLock)) {
          artifacts.push(`${pkg}/yalc.lock`);
        }
      }
    } catch (err) {
      // Ignore glob errors
    }
  }
  
  return artifacts;
}

/**
 * Detect protocol conflicts in package.json files
 */
export async function detectProtocolConflicts(
  rootDir: string,
  lock?: any
): Promise<ProtocolConflict[]> {
  const conflicts: ProtocolConflict[] = [];
  
  // Find all package.json files
  const { glob } = await import('glob');
  const packageJsonFiles = await glob('**/package.json', { 
    cwd: rootDir,
    ignore: ['node_modules/**', 'dist/**', '.yalc/**']
  });
  
  for (const pkgJsonPath of packageJsonFiles) {
    const fullPath = join(rootDir, pkgJsonPath);
    
    try {
      const content = await fsp.readFile(fullPath, 'utf8');
      const pkg = JSON.parse(content);
      
      const sections = ['dependencies', 'devDependencies', 'peerDependencies'];
      const protocols = new Map<string, string[]>(); // package -> protocols
      
      for (const section of sections) {
        const deps = pkg[section];
        if (!deps || typeof deps !== 'object') {continue;}
        
        for (const [depName, spec] of Object.entries(deps)) {
          if (typeof spec !== 'string') {continue;}
          
          let protocol = 'npm';
          if (spec.startsWith('link:')) {
            protocol = 'link';
          } else if (spec.startsWith('workspace:')) {
            protocol = 'workspace';
          } else if (spec.startsWith('file:')) {
            protocol = 'file';
          }
          
          if (!protocols.has(depName)) {
            protocols.set(depName, []);
          }
          protocols.get(depName)!.push(protocol);
        }
      }
      
      // Find conflicts (same package with different protocols)
      for (const [depName, depProtocols] of protocols) {
        const uniqueProtocols = [...new Set(depProtocols)];
        if (uniqueProtocols.length > 1) {
          conflicts.push({
            package: depName,
            protocols: uniqueProtocols,
            manifest: pkgJsonPath,
            sections: sections.filter(s => pkg[s]?.[depName]),
          });
        }
      }
    } catch (err) {
      logger.warn(`Failed to parse ${pkgJsonPath}`, err);
    }
  }
  
  return conflicts;
}

/**
 * Detect all stale artifacts
 */
export async function detectStaleArtifacts(rootDir: string): Promise<StaleArtifacts> {
  const [yalcArtifacts, protocolConflicts] = await Promise.all([
    findYalcArtifacts(rootDir),
    detectProtocolConflicts(rootDir),
  ]);
  
  return {
    yalc: yalcArtifacts,
    conflicts: protocolConflicts.map(c => ({
      package: c.package,
      protocols: c.protocols,
    })),
  };
}

/**
 * Check if a package has mixed protocols
 */
export function hasMixedProtocols(conflicts: ProtocolConflict[], packageName: string): boolean {
  return conflicts.some(c => c.package === packageName);
}

/**
 * Get suggested cleanup commands based on detected artifacts
 */
export function getCleanupSuggestions(artifacts: StaleArtifacts): string[] {
  const suggestions: string[] = [];
  
  if (artifacts.yalc.length > 0) {
    suggestions.push('Run "kb devlink clean" to remove yalc artifacts');
  }
  
  if (artifacts.conflicts.length > 0) {
    suggestions.push('Run "kb devlink clean --hard" to reset all protocols');
    suggestions.push('Then run "kb devlink apply" to reapply correct protocols');
  }
  
  return suggestions;
}
