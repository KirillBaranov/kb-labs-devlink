import { logger } from '@devlink/infra/logging/logger';
import type { WatchOptions } from '@devlink/application/devlink/legacy/watch';
import type { DevLinkWatcher } from '@devlink/application/devlink/legacy/watch';
import type { DevLinkServices } from '../../../domain/devlink/interfaces';
import { defaultDevLinkServices } from '../services';

export { DevLinkWatcher } from '@devlink/application/devlink/legacy/watch';
export type { WatchOptions } from '@devlink/application/devlink/legacy/watch';
export type { AllDevLinkEvents as WatchEvent } from '@devlink/application/devlink/legacy/watch';
export type { DryRunResult } from '@devlink/application/devlink/legacy/watch';

export async function watchDevLink(
  options: WatchOptions,
  services: DevLinkServices = defaultDevLinkServices,
): Promise<DevLinkWatcher> {
  logger.info('Starting DevLink watch', {
    rootDir: options.rootDir,
    mode: options.mode || 'auto',
    dryRun: options.dryRun || false,
  });

  try {
    const watcher = await services.watcherFactory.create(options);
    return watcher;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to start watch', { error: errorMessage });
    throw error;
  }
}
