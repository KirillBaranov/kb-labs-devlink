/**
 * DevLink commands registry
 * Single source of truth for devlink commands
 */

import { manifest } from '../../types/manifest';

const manifestCommands = manifest.cli?.commands ?? [];

/**
 * Get all devlink command IDs from the manifest
 */
export function getDevlinkCommandIds(): string[] {
  return manifestCommands
    .filter((cmd) => cmd.group === 'devlink')
    .map((cmd) => cmd.id);
}

/**
 * Get devlink commands for quick actions
 */
export function getDevlinkQuickActionCommands(): string[] {
  // Return only the most commonly used commands for quick actions
  const quickActionCommands = [
    'devlink:clean',
    'devlink:plan', 
    'devlink:apply'
  ];
  
  return quickActionCommands.filter((cmd) =>
    manifestCommands.some((c) => c.id === cmd)
  );
}
