/**
 * DevLink commands registry
 * Single source of truth for devlink commands
 */

import { commands } from '../cli.manifest';

/**
 * Get all devlink command IDs from the manifest
 */
export function getDevlinkCommandIds(): string[] {
  return commands
    .filter(cmd => cmd.group === 'devlink')
    .map(cmd => cmd.id);
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
  
  return quickActionCommands.filter(cmd => 
    commands.some(c => c.id === cmd)
  );
}
