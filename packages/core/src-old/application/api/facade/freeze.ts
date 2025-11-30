import {
  freeze as freezeApplication,
  type FreezeOptions,
  type FreezeResult,
} from '@devlink/application/devlink/freeze/freeze';

export type { FreezeOptions, FreezeResult } from '@devlink/application/devlink/freeze/freeze';

export function freeze(plan: Parameters<typeof freezeApplication>[0], opts: FreezeOptions = {}) {
  return freezeApplication(plan, opts);
}
