/**
 * @module @kb-labs/devlink-contracts/utils
 * Utility functions for DevLink
 */

import { createHash } from 'node:crypto';

/**
 * Generate SHA-1 hash of a string
 *
 * @param content - String content to hash
 * @returns SHA-1 hash as hex string
 */
export function sha1(content: string): string {
  return createHash('sha1').update(content, 'utf8').digest('hex');
}
