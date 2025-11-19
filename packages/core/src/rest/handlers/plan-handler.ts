import { existsSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
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

interface HandlerRuntime {
  env?: (key: string) => string | undefined;
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

interface HandlerContext {
  requestId: string;
  pluginId: string;
  workdir?: string;
  runtime?: HandlerRuntime;
}

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

export async function handlePlan(
  input: unknown,
  ctx: HandlerContext
): Promise<PlanResponse> {
  const log = ctx.runtime?.log ?? (() => undefined);
  const env = ctx.runtime?.env ?? ((key: string) => process.env[key]);

  const parseResult = PlanRequestSchema.safeParse(input);
  if (!parseResult.success) {
    const unknownView = hasUnknownViewIssue(parseResult.error as unknown as z.ZodError<unknown>);
    if (unknownView) {
      const result: PlanGatewayError = {
        ok: false,
        code: 'DEVLINK_PLAN_WIDGET_UNKNOWN',
        message: `Unsupported view parameter: ${unknownView}`,
        hint: "Use one of: 'overview', 'overview.actions', 'overview.diagnostics', 'dependencies.tree', 'dependencies.table'.",
      };
      return result;
    }

    log('warn', 'DevLink plan handler input validation failed', {
      requestId: ctx.requestId,
      issues: parseResult.error.issues,
    });
    const error: PlanGatewayError = {
      ok: false,
      code: 'DEVLINK_PLAN_INVALID_INPUT',
      message: 'Invalid request parameters',
      hint: 'Ensure query parameters match the expected schema.',
    };
    return error;
  }

  // TypeScript cannot infer types from Zod v4 safeParse during DTS generation
  // Explicitly assert the type to ensure correct DTS output
  const requestData = parseResult.data as PlanRequest;
  const workspaceResolution = await resolveWorkspaceRoot({
    cwd: requestData.cwd,
    startDir: requestData.cwd ?? ctx.workdir ?? process.cwd(),
    env: {
      KB_LABS_WORKSPACE_ROOT: env('KB_LABS_WORKSPACE_ROOT'),
      KB_LABS_REPO_ROOT: env('KB_LABS_REPO_ROOT'),
    },
  });
  const planRoot = findPlanRoot(workspaceResolution.rootDir) ?? findPlanRoot(ctx.workdir);
  const resolvedRoot = planRoot ?? workspaceResolution.rootDir;

  try {
    const dto: DevLinkPlanDTO = await loadPlanDTO(resolvedRoot);
    log('info', 'DevLink plan served', {
      requestId: ctx.requestId,
      root: resolvedRoot,
      workspaceSource: workspaceResolution.source,
      packages: dto.summary.packageCount,
      actions: dto.summary.actionCount,
    });

    if (requestData.view) {
      const viewKey: DevlinkPlanView = requestData.view;
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

    return dto;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', 'DevLink plan handler failed', {
      requestId: ctx.requestId,
      root: resolvedRoot,
      error: message,
    });
    const result: PlanGatewayError = {
      ok: false,
      code: 'DEVLINK_PLAN_LOAD_FAILED',
      message,
      hint: `Ensure kb devlink plan has been generated in ${resolvedRoot} and .kb/devlink/last-plan.json exists.`,
    };
    return result;
  }
}
