import { z } from 'zod';

export const schemaReferenceSchema = z.object({
  ref: z.string().min(1),
  format: z
    .enum(['json-schema', 'zod', 'ts', 'openapi'])
    .optional(),
});

export const restRouteContractSchema = z.object({
  id: z.string().min(1),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  path: z.string().min(1),
  description: z.string().optional(),
  request: schemaReferenceSchema.optional(),
  response: schemaReferenceSchema.optional(),
  produces: z.array(z.string().min(1)).optional(),
});

export const restApiContractSchema = z.object({
  basePath: z.string().min(1),
  routes: z.record(z.string().min(1), restRouteContractSchema),
});

export const apiContractSchema = z.object({
  rest: restApiContractSchema.optional(),
});

