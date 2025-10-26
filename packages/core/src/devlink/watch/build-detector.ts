import { join } from "node:path";
import { promises as fsp, existsSync } from "node:fs";
import { exists } from "../../utils/fs";
import { logger } from "../../utils/logger";
import type { PackageRef } from "../types";

/**
 * Detect build and dev commands for a package
 * Priority для build: kbLabs.build.command → scripts.build
 * Priority для dev: kbLabs.dev.command → scripts.dev
 */
export async function detectBuildCommands(pkgRef: PackageRef): Promise<{
  build: string | null;
  dev: string | null;
  timeoutMs?: number;
}> {
  const pkgJsonPath = join(pkgRef.dir, 'package.json');
  
  if (!(await exists(pkgJsonPath))) {
    return { build: null, dev: null };
  }
  
  try {
    const content = await fsp.readFile(pkgJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    
    // Priority для build: kbLabs.build.command → scripts.build
    const build = pkg.kbLabs?.build?.command 
      ?? (pkg.scripts?.build ? 'pnpm run build' : null);
    
    // Priority для dev: kbLabs.dev.command → scripts.dev
    const dev = pkg.kbLabs?.dev?.command
      ?? (pkg.scripts?.dev ? 'pnpm run dev' : null);
    
    const timeoutMs = pkg.kbLabs?.watch?.timeoutMs;
    
    logger.debug("Detected build commands", { 
      pkg: pkgRef.name, 
      build, 
      dev, 
      timeoutMs 
    });
    
    return { build, dev, timeoutMs };
  } catch (err) {
    logger.debug("Failed to read package.json for build detection", { 
      pkg: pkgRef.name, 
      err 
    });
    return { build: null, dev: null };
  }
}

/**
 * Get watch patterns (white/black list)
 */
export function getWatchPatterns(pkgDir?: string): {
  include: string[];
  exclude: string[];
} {
  // Определяем, где находятся исходники в этом пакете
  const srcPatterns = [];
  
  if (pkgDir) {
    // Проверяем, есть ли packages/*/src структура
    const packagesDir = join(pkgDir, 'packages');
    if (existsSync(packagesDir)) {
      // Это monorepo пакет - отслеживаем packages/*/src/**
      srcPatterns.push('packages/*/src/**');
    } else {
      // Обычный пакет - отслеживаем src/**
      srcPatterns.push('src/**');
    }
  } else {
    // Fallback для совместимости
    srcPatterns.push('src/**');
  }
  
  return {
    include: [
      ...srcPatterns,
      'package.json',
      'tsconfig*.json',
      '.env*'
    ],
    exclude: [
      'dist/**',
      'node_modules/**',
      '.yalc/**',
      '.pnpm/**', // pnpm hardlinks
      '.kb-labs/**',
      '.kb/**',
      '.git/**',
      '.idea/**',
      '.vscode/**',
      'coverage/**',
      '**/*.map',
      '**/*.log',
      '**/*.test.*',
      '**/*.spec.*',
      '__tests__/**',
      '__mocks__/**',
      '**/*~',
      '**/.#*',
      '**/*.swp',
      '**/*.swx',
      '**/.DS_Store',
      '**/*.tsbuildinfo',
      '**/.vite/**',
      '**/.turbo/**',
      '**/.parcel-cache/**'
    ]
  };
}

/**
 * Check if path should be ignored for watching
 */
export function shouldIgnorePath(relativePath: string): boolean {
  const patterns = getWatchPatterns();
  return patterns.exclude.some(pattern => {
    // Простая проверка на вхождение паттерна
    if (pattern.includes('**')) {
      const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
      return regex.test(relativePath);
    }
    return relativePath.includes(pattern);
  });
}

/**
 * Detect watch paths for a provider
 * Returns array of glob patterns relative to package dir
 */
export function detectWatchPaths(pkgRef: PackageRef): string[] {
  const patterns = getWatchPatterns();
  logger.debug("Watch paths detected", { 
    pkg: pkgRef.name, 
    include: patterns.include,
    exclude: patterns.exclude.length
  });
  return patterns.include;
}

