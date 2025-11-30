import {
  status as statusApplication,
  type StatusOptions,
  type StatusReport,
} from '@devlink/application/devlink/status/status';

export type { StatusOptions, StatusReport } from '@devlink/application/devlink/status/status';

export function status(opts: StatusOptions): Promise<StatusReport> {
  return statusApplication(opts);
}
