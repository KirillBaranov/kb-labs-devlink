import type {
  DevLinkWatcher} from '@devlink/application/devlink/watch/watch';
import {
  watchDevLink,
  type WatchOptions,
  type WatchEvent,
  type DryRunResult,
} from '@devlink/application/devlink/watch/watch';

export { DevLinkWatcher } from '@devlink/application/devlink/watch/watch';
export type { WatchOptions } from '@devlink/application/devlink/watch/watch';
export type { WatchEvent } from '@devlink/application/devlink/watch/watch';
export type { DryRunResult } from '@devlink/application/devlink/watch/watch';

export async function watch(options: WatchOptions): Promise<DevLinkWatcher> {
  return watchDevLink(options);
}
