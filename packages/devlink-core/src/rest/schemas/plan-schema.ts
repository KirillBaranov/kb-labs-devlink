import type { z } from 'zod';
import {
  DevlinkPlanRequestSchema,
  DevlinkPlanResponseSchema,
  DevlinkPlanSchema,
  DevlinkPlanWidgetsSchema,
  PlanErrorSchema as DevlinkPlanErrorSchema,
  PlanWidgetResponseSchema as DevlinkPlanWidgetResponseSchema,
} from '@kb-labs/devlink-contracts/schema';

export const PlanRequestSchema = DevlinkPlanRequestSchema;
export const PlanResponseSchema = DevlinkPlanResponseSchema;

export const PlanWidgetsSchema = DevlinkPlanWidgetsSchema;
export const DevLinkPlanSchema = DevlinkPlanSchema;
export const PlanErrorSchema = DevlinkPlanErrorSchema;
export const PlanWidgetResponseSchema = DevlinkPlanWidgetResponseSchema;

// Explicitly define PlanRequest type to avoid DTS generation issues with z.infer
export type PlanRequest = {
  cwd?: string;
  view?: 'overview' | 'overview.actions' | 'overview.diagnostics' | 'dependencies.tree' | 'dependencies.table';
};
export type DevLinkPlanDTO = z.infer<typeof DevLinkPlanSchema>;
export type PlanGatewayError = z.infer<typeof PlanErrorSchema>;
export type PlanWidgetResponse = z.infer<typeof PlanWidgetResponseSchema>;
