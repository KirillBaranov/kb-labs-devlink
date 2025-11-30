import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { definePluginHandler } from '@kb-labs/plugin-runtime';
import { loadPlanDTO, type DevLinkPlanDTO } from '../plan-dto';
import type {
  DevLinkPlanSchema,
  PlanErrorSchema,
  PlanWidgetResponseSchema} from '../schemas/plan-schema';
import {
  PlanRequestSchema,
  type PlanGatewayError,
  type PlanRequest,
  type PlanWidgetResponse
} from '../schemas/plan-schema';
import type { z } from 'zod';

import { resolveWorkspaceRoot } from '@kb-labs/core-workspace';
import type { DevlinkPlanView } from '@kb-labs/devlink-contracts/schema';

const PLAN_DIR_RELATIVE = join('.kb', 'devlink');

function hasUnknownViewIssue(error: z.ZodError): string | undefined {
  for (const issue of error.issues) {
    // Check if this is an invalid_value issue on the 'view' field (Zod v4 uses 'invalid_value')
    // Access properties via type assertion since Zod v4 doesn't export discriminated union types
    const issueAny = issue as { code?: string; received?: unknown; path?: (string | number)[] };
    if (
      issueAny.code === 'invalid_value' &&
      Array.isArray(issueAny.path) &&
      issueAny.path.length > 0 &&
      issueAny.path[0] === 'view'
    ) {
      const received = issueAny.received;
      return typeof received === 'string' ? received : String(received);
    }
  }
  return undefined;
}

function findPlanRoot(start?: string): string | undefined {
  if (!start) {return undefined;}

  let current = resolvePath(start);
  const seen = new Set<string>();

  while (!seen.has(current)) {
    const candidatePlanDir = join(current, PLAN_DIR_RELATIVE);
    if (existsSync(candidatePlanDir)) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }

    seen.add(current);
    current = parent;
  }

  return undefined;
}

type PlanResponse =
  | z.infer<typeof DevLinkPlanSchema>
  | z.infer<typeof PlanErrorSchema>
  | z.infer<typeof PlanWidgetResponseSchema>;

function resolveWidgetPayload(dto: DevLinkPlanDTO, viewKey: DevlinkPlanView): PlanWidgetResponse | undefined {
  // Explicitly type the dto parameter to ensure TypeScript can resolve types during DTS generation
  const typedDto: DevLinkPlanDTO = dto;
  switch (viewKey) {
    case 'overview':
      return typedDto.widgets.overview.infoPanel;
    case 'overview.actions':
      return typedDto.widgets.overview.actionsChart;
    case 'overview.diagnostics':
      return typedDto.widgets.overview.diagnostics;
    case 'dependencies.tree':
      return typedDto.widgets.dependencies.repoTree;
    case 'dependencies.table':
      return typedDto.widgets.dependencies.packagesTable;
    default:
      return undefined;
  }
}

/**
 * DevLink Plan REST Handler (Exemplary Migration)
 *
 * This handler demonstrates best practices for the new plugin architecture:
 * ✅ Type-safe input/output with definePluginHandler
 * ✅ Automatic Zod validation
 * ✅ Clean ctx.output API (no optional chaining)
 * ✅ Clean ctx.runtime.env API
 * ✅ Comprehensive error handling with typed error responses
 * ✅ Proper logging with structured metadata
 *
 * @example
 * ```typescript
 * // Automatic validation and type inference
 * const handler = definePluginHandler<PlanRequest, PlanResponse>({
 *   schema: { input: PlanRequestSchema },
 *   async handle(input, ctx) {
 *     // input is already validated and typed!
 *     ctx.output.info('Processing request');
 *     return { ok: true, ... };
 *   },
 *   onError: async (error, ctx) => {
 *     // Custom error handling
 *     return { ok: false, code: 'ERROR', message: error.message };
 *   }
 * });
 * ```
 */
export const handlePlan = definePluginHandler<PlanRequest, PlanResponse>({
  // Automatic input validation (output validation not enforced for union types)
  schema: {
    input: PlanRequestSchema,
  },

  async handle(input, ctx) {
    // ✅ NEW: Clean env access (no optional chaining needed)
    const env = ctx.runtime.env;

    // ✅ Input is already validated and typed!
    const workspaceResolution = await resolveWorkspaceRoot({
      cwd: input.cwd,
      startDir: input.cwd ?? ctx.workdir ?? process.cwd(),
      env: {
        KB_LABS_WORKSPACE_ROOT: env('KB_LABS_WORKSPACE_ROOT'),
        KB_LABS_REPO_ROOT: env('KB_LABS_REPO_ROOT'),
      },
    });

    const planRoot = findPlanRoot(workspaceResolution.rootDir) ?? findPlanRoot(ctx.workdir);
    const resolvedRoot = planRoot ?? workspaceResolution.rootDir;

    const dto: DevLinkPlanDTO = await loadPlanDTO(resolvedRoot);

    // ✅ NEW: Use ctx.output (clean, always available)
    ctx.output.info('DevLink plan served', {
      requestId: ctx.requestId,
      root: resolvedRoot,
      workspaceSource: workspaceResolution.source,
      packages: dto.summary.packageCount,
      actions: dto.summary.actionCount,
    });

    // Handle view-specific responses
    if (input.view) {
      const viewKey: DevlinkPlanView = input.view;
      const payload = resolveWidgetPayload(dto, viewKey);

      if (!payload) {
        const result: PlanGatewayError = {
          ok: false,
          code: 'DEVLINK_PLAN_WIDGET_UNKNOWN',
          message: `Unsupported view parameter: ${viewKey}`,
          hint: "Use one of: 'overview', 'overview.actions', 'overview.diagnostics', 'dependencies.tree', 'dependencies.table'.",
        };
        return result;
      }

      return payload;
    }

    // Return full plan DTO
    return dto;
  },

  // ✅ NEW: Custom error handler for graceful error responses
  async onError(error, ctx) {
    const message = error instanceof Error ? error.message : String(error);

    // Log error with full context
    ctx.output.error('DevLink plan handler failed', {
      requestId: ctx.requestId,
      workdir: ctx.workdir,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Return typed error response
    const result: PlanGatewayError = {
      ok: false,
      code: 'DEVLINK_PLAN_LOAD_FAILED',
      message,
      hint: `Ensure kb devlink plan has been generated and .kb/devlink/last-plan.json exists.`,
    };

    return result;
  },
});
