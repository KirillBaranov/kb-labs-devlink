import { describe, it, expect } from 'vitest';
import { PlanRequestSchema, PlanResponseSchema } from '../schemas/plan-schema';
import {
  DevlinkPlanRequestSchema,
  DevlinkPlanResponseSchema,
  PlanViewSchema,
} from '@kb-labs/devlink-contracts/schema';

describe('DevLink REST schemas', () => {
  it('reuses the contract request schema instance', () => {
    expect(PlanRequestSchema).toBe(DevlinkPlanRequestSchema);
  });

  it('reuses the contract response schema instance', () => {
    expect(PlanResponseSchema).toBe(DevlinkPlanResponseSchema);
  });

  it('shares the same view enumeration with the contract', () => {
    for (const view of PlanViewSchema.options) {
      const parsed = PlanRequestSchema.safeParse({ view });
      expect(parsed.success).toBe(true);
    }

    const invalid = PlanRequestSchema.safeParse({ view: 'invalid.view' });
    expect(invalid.success).toBe(false);
  });
});


