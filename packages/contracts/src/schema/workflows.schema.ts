import { z } from 'zod';

export const workflowStepSchema = z.object({
  id: z.string().min(1),
  commandId: z.string().min(1),
  produces: z.array(z.string().min(1)).optional(),
});

export const workflowContractSchema = z.object({
  id: z.string().min(1),
  description: z.string().optional(),
  produces: z.array(z.string().min(1)).optional(),
  steps: z.array(workflowStepSchema).min(1),
});

export const workflowContractMapSchema = z.record(
  z.string().min(1),
  workflowContractSchema,
);

