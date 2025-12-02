#!/usr/bin/env node

/**
 * Migration script to update imports for devlink refactoring
 * Updates path aliases and relative imports to new structure
 */

const fs = require('fs');
const path = require('path');

// Mapping of old paths to new paths
const PATH_MAPPINGS = {
  // Path aliases
  '@devlink/application/devlink/legacy': '../core/operations',
  '@devlink/application/devlink': '../core',
  '@devlink/domain/devlink': '../core/models',
  '@devlink/infra/cli': '../cli/commands',
  '@devlink/infra/discovery': '../core/discovery',
  '@devlink/infra': '../infrastructure',
  '@devlink/shared/utils': '../utils',
  '@devlink/shared/types': '../types',
  '@devlink/shared/manifest': '../types/manifest',
  '@devlink/shared/analytics': '../infrastructure/analytics',
  '@devlink/shared/state': '../infrastructure/state',

  // Relative paths (from files that moved)
  '../application/devlink/legacy': '../core/operations',
  '../../application/devlink/legacy': '../operations',
  '../../../application/devlink/legacy': '../../operations',
  './legacy': './operations',

  '../domain/devlink': '../core/models',
  '../../domain/devlink': '../models',
  '../../../domain/devlink': '../../models',

  '../infra/cli': '../cli/commands',
  '../../infra/cli': '../cli/commands',
  './cli': './cli/commands',

  '../infra/discovery': '../core/discovery',
  '../../infra/discovery': '../discovery',

  '../infra': '../infrastructure',
  '../../infra': '../infrastructure',
  './infra': './infrastructure',

  '../shared/utils': '../utils',
  '../../shared/utils': '../utils',
  '../shared/types': '../types',
  '../../shared/types': '../types',
  '../shared/manifest': '../types/manifest',
  '../../shared/manifest': '../types/manifest',

  '../api': '../rest',
  '../../api': '../rest',
  './api': './rest',

  '../rollback': '../utils/rollback',
  '../../rollback': '../utils/rollback',
};

function updateImportsInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let updated = false;

  // Update import/export statements
  content = content.replace(/(import|export)([^'"]*['"])([^'"]+)(['"])/g, (match, keyword, before, importPath, after) => {
    for (const [oldPath, newPath] of Object.entries(PATH_MAPPINGS)) {
      if (importPath === oldPath || importPath.startsWith(oldPath + '/')) {
        const replacement = importPath.replace(oldPath, newPath);
        if (replacement !== importPath) {
          console.log(`  ${filePath}: ${importPath} → ${replacement}`);
          updated = true;
          return `${keyword}${before}${replacement}${after}`;
        }
      }
    }
    return match;
  });

  if (updated) {
    fs.writeFileSync(filePath, content, 'utf8');
  }

  return updated;
}

function processDirectory(dir) {
  const files = fs.readdirSync(dir);
  let totalUpdated = 0;

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      totalUpdated += processDirectory(filePath);
    } else if (file.endsWith('.ts') && !file.endsWith('.d.ts')) {
      if (updateImportsInFile(filePath)) {
        totalUpdated++;
      }
    }
  }

  return totalUpdated;
}

// Process src-new directory
const srcNewDir = path.join(__dirname, 'packages/core/src-new');

console.log('Starting import updates...\n');
const updated = processDirectory(srcNewDir);
console.log(`\nComplete! Updated ${updated} files.`);
