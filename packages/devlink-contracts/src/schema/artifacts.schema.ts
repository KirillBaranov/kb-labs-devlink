import { z } from 'zod';

export const artifactExampleSchema = z.object({
  summary: z.string().optional(),
  payload: z.unknown().optional(),
});

export const artifactContractSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['file', 'json', 'markdown', 'binary', 'dir', 'log']),
  description: z.string().optional(),
  pathPattern: z.string().optional(),
  mediaType: z.string().optional(),
  schemaRef: z.string().optional(),
  example: artifactExampleSchema.optional(),
});

export const artifactsContractMapSchema = z.record(
  z.string().min(1),
  artifactContractSchema,
);

