import {
  applyPlan as applyPlanApplication,
  type ApplyPlanOptions,
  type ApplyPlanResult,
} from '@devlink/application/devlink/apply/apply-plan';

export type { ApplyPlanOptions, ApplyPlanResult } from '@devlink/application/devlink/apply/apply-plan';

export function apply(plan: Parameters<typeof applyPlanApplication>[0], opts: ApplyPlanOptions = {}) {
  return applyPlanApplication(plan, opts);
}
