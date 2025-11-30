import {
  scanAndPlan as scanAndPlanApplication,
  type ScanAndPlanOptions,
  type ScanAndPlanResult,
} from '@devlink/application/devlink/scan/scan-and-plan';

export type { ScanAndPlanOptions, ScanAndPlanResult } from '@devlink/application/devlink/scan/scan-and-plan';

export function scanAndPlan(opts: ScanAndPlanOptions): Promise<ScanAndPlanResult> {
  return scanAndPlanApplication(opts);
}
