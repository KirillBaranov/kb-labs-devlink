import { join } from "node:path";
import { promises as fsp, existsSync } from "node:fs";
import { exists } from '@kb-labs/devlink-adapters/filesystem';
import { logger } from '@kb-labs/devlink-adapters/logging';
import type { PackageRef } from "../types";
import { minimatch } from "minimatch";

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

    // Legacy support: devlink.watch.build
    let buildOverride = pkg.devlink?.watch?.build;
    if (Array.isArray(buildOverride)) {
      buildOverride = buildOverride.join(' && ');
    }
    if (typeof buildOverride !== 'string') {
      buildOverride = undefined;
    }

    // Legacy support: devlink.watch.dev
    let devOverride = pkg.devlink?.watch?.dev;
    if (Array.isArray(devOverride)) {
      devOverride = devOverride.join(' && ');
    }
    if (typeof devOverride !== 'string') {
      devOverride = undefined;
    }
    
    // Priority для build: kbLabs.build.command → scripts.build
    const build = buildOverride
      ?? pkg.kbLabs?.build?.command 
      ?? (pkg.scripts?.build ? 'pnpm run build' : null);
    
    // Priority для dev: kbLabs.dev.command → scripts.dev
    const dev = devOverride
      ?? pkg.kbLabs?.dev?.command
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

export async function detectBuildCommand(pkgRef: PackageRef): Promise<string | null> {
  const { build } = await detectBuildCommands(pkgRef);
  return build;
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
      // Это monorepo пакет - отслеживаем packages/*/src/**/*
      srcPatterns.push('packages/*/src/**/*');
    } else {
      // Обычный пакет - отслеживаем src/**/*
      srcPatterns.push('src/**/*');
    }
  } else {
    // Fallback для совместимости
    srcPatterns.push('src/**/*');
  }
  
  return {
    include: [
      ...srcPatterns,
      'package.json',
      'tsconfig*.json',
      'dist/**/*',
      '.env*'
    ],
    exclude: [
      'dist/**',
      '**/dist/**',
      'node_modules/**',
      '**/node_modules/**',
      '.yalc/**',
      '.pnpm/**', // pnpm hardlinks
      '.kb-labs/**',
      '.kb/**',
      '**/.kb/**',
      '.kb/devlink/backups/**',
      '**/.kb/devlink/backups/**',
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
  return patterns.exclude.some((pattern) => minimatch(relativePath, pattern, { dot: true }));
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

