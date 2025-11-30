# Migration Example: kb-labs-devlink REST Handler

This document demonstrates the migration of kb-labs-devlink's REST handler to the new plugin architecture with `definePluginHandler`.

## Overview

kb-labs-devlink serves as an **exemplary reference implementation** showcasing:
- ✅ Type-safe handler definitions with generics
- ✅ Automatic input validation
- ✅ Clean `ctx.output` API (no optional chaining)
- ✅ Comprehensive error handling with typed error responses
- ✅ Proper logging with structured metadata
- ✅ Custom error handler for graceful degradation

---

## File: `packages/core/src/rest/handlers/plan-handler.ts`

### ❌ Before (Legacy API)

```typescript
interface HandlerRuntime {
  env?: (key: string) => string | undefined;
  log?: (level: 'debug' | 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => void;
}

interface HandlerContext {
  requestId: string;
  pluginId: string;
  workdir?: string;
  runtime?: HandlerRuntime;
  logger?: {
    debug: (msg: string, meta?: Record<string, unknown>) => void;
    info: (msg: string, meta?: Record<string, unknown>) => void;
    warn: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export async function handlePlan(
  input: unknown,
  ctx: HandlerContext
): Promise<PlanResponse> {
  const env = ctx.runtime?.env ?? ((key: string) => process.env[key]);

  // Manual validation with fallback
  const parseResult = PlanRequestSchema.safeParse(input);
  if (!parseResult.success) {
    // Manual error handling
    ctx.logger?.warn('DevLink plan handler input validation failed', {
      requestId: ctx.requestId,
      issues: parseResult.error.issues,
    });
    return {
      ok: false,
      code: 'DEVLINK_PLAN_INVALID_INPUT',
      message: 'Invalid request parameters',
    };
  }

  const requestData = parseResult.data as PlanRequest;

  try {
    const dto = await loadPlanDTO(resolvedRoot);

    // Optional chaining everywhere
    ctx.logger?.info('DevLink plan served', {
      requestId: ctx.requestId,
      root: resolvedRoot,
      packages: dto.summary.packageCount,
    });

    return dto;
  } catch (error) {
    // Manual error handling
    ctx.logger?.error('DevLink plan handler failed', {
      requestId: ctx.requestId,
      error: message,
    });
    return {
      ok: false,
      code: 'DEVLINK_PLAN_LOAD_FAILED',
      message,
    };
  }
}
```

**Problems:**
- ❌ No type safety on input/output
- ❌ Manual schema parsing with `safeParse`
- ❌ Optional chaining (`ctx.logger?.`) everywhere
- ❌ Manual error handling with try/catch
- ❌ Custom context types (not reusable)
- ❌ No automatic validation
- ❌ Error handling scattered throughout

---

### ✅ After (New API with `definePluginHandler`)

```typescript
import { definePluginHandler } from '@kb-labs/plugin-runtime';

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
```

**Benefits:**
- ✅ **Type safety**: Input/output typed with generics
- ✅ **Auto-validation**: Zod schemas applied automatically
- ✅ **Clean API**: `ctx.output.info()` instead of `ctx.logger?.info()`
- ✅ **No optional chaining**: APIs are always available
- ✅ **Error handling**: Built into `definePluginHandler` via `onError`
- ✅ **Best practices**: Demonstrates recommended patterns
- ✅ **Separation of concerns**: Happy path vs error handling
- ✅ **Comprehensive logging**: Structured metadata with all context

---

## Migration Steps

### 1. Add Dependency

```json
// package.json
{
  "dependencies": {
    "@kb-labs/plugin-runtime": "link:../../../kb-labs-plugin/packages/runtime"
  }
}
```

### 2. Update Import

```typescript
// Before
// No import needed (used raw function)

// After
import { definePluginHandler } from '@kb-labs/plugin-runtime';
```

### 3. Remove Custom Context Types

```typescript
// Before
interface HandlerContext {
  requestId: string;
  pluginId: string;
  workdir?: string;
  runtime?: HandlerRuntime;
  logger?: { ... };
}

// After
// No custom context needed! Use PluginHandlerContext from runtime
```

### 4. Use Builder Pattern

```typescript
export const handlePlan = definePluginHandler<PlanRequest, PlanResponse>({
  schema: {
    input: PlanRequestSchema,
  },
  async handle(input, ctx) {
    // Your logic here
  },
  async onError(error, ctx) {
    // Error handling here
    return { ok: false, code: 'ERROR', message: error.message };
  }
});
```

### 5. Update Logging

```typescript
// Before
ctx.logger?.info('Message');

// After
ctx.output.info('Message');
```

### 6. Update Environment Access

```typescript
// Before
const env = ctx.runtime?.env ?? ((key: string) => process.env[key]);

// After
const env = ctx.runtime.env;
```

---

## Comparison Table

| Aspect | Legacy API | New API |
|--------|-----------|---------|
| **Input typing** | `unknown` with manual parse | Generic `TInput` |
| **Output typing** | `unknown` | Generic `TOutput` |
| **Validation** | Manual `schema.safeParse()` | Automatic via config |
| **Logging** | `ctx.logger?.info()` | `ctx.output.info()` |
| **Error handling** | Manual try/catch | Built into `onError` |
| **Optional chaining** | Everywhere (`?.`) | Not needed |
| **Type inference** | No | Yes, automatic |
| **Custom context** | Required | Not needed |
| **Best practices** | Need to know | Built-in |

---

## Testing

### Before Migration

```typescript
const result = await handlePlan({ view: 'overview' }, {
  requestId: 'test-123',
  pluginId: 'devlink',
  workdir: '/path/to/workspace',
  logger: mockLogger, // Optional
  runtime: {
    env: mockEnv, // Optional
  }
});
```

### After Migration

```typescript
const result = await handlePlan({ view: 'overview' }, {
  requestId: 'test-123',
  pluginId: 'devlink',
  workdir: '/path/to/workspace',
  output: mockOutput,  // Clean mock
  runtime: {
    env: mockEnv,
    fs: mockFs,
    fetch: mockFetch,
  },
  api: mockApi
});
```

**Benefits:**
- ✅ Cleaner mock structure
- ✅ Explicit required fields
- ✅ Type-safe mocks

---

## Advanced Example: Error Handling

### Custom Error Handler with Logging

```typescript
export const handlePlan = definePluginHandler<PlanRequest, PlanResponse>({
  schema: {
    input: PlanRequestSchema,
  },

  async handle(input, ctx) {
    // Happy path - clean and focused
    const dto = await loadPlanDTO(resolvedRoot);
    ctx.output.info('DevLink plan served', { ... });
    return dto;
  },

  // Error path - separated from happy path
  async onError(error, ctx) {
    // Classify error type
    if (error instanceof ValidationError) {
      ctx.output.warn('Validation failed', { error: error.message });
      return {
        ok: false,
        code: 'DEVLINK_PLAN_INVALID_INPUT',
        message: error.message,
      };
    }

    if (error instanceof FileNotFoundError) {
      ctx.output.error('Plan file not found', { path: error.path });
      return {
        ok: false,
        code: 'DEVLINK_PLAN_NOT_FOUND',
        message: `Plan not found: ${error.path}`,
      };
    }

    // Generic error
    ctx.output.error('Unexpected error', {
      error: error.message,
      stack: error.stack,
    });

    return {
      ok: false,
      code: 'DEVLINK_PLAN_LOAD_FAILED',
      message: error.message,
    };
  },
});
```

---

## Next Steps

1. **Review** the migration guide: `kb-labs-plugin/MIGRATION-GUIDE.md`
2. **Migrate** other REST handlers in devlink
3. **Test** thoroughly after migration
4. **Remove** optional chaining (`?.`) from new APIs
5. **Add** proper types for input/output
6. **Use** Zod schemas for validation
7. **Leverage** `onError` for error handling

---

## Resources

- [Full Migration Guide](../../kb-labs-plugin/MIGRATION-GUIDE.md)
- [definePluginHandler Docs](../../kb-labs-plugin/packages/runtime/src/define-plugin-handler.ts)
- [Context Factories](../../kb-labs-plugin/packages/runtime/src/context-factories.ts)
- [Type Definitions](../../kb-labs-plugin/packages/runtime/src/types.ts)
- [Template Example](../../kb-labs-plugin-template/MIGRATION-EXAMPLE-TEMPLATE.md)

---

**Last Updated:** 2025-11-29
**Status:** ✅ Example Complete
**Plugin Version:** @kb-labs/devlink-core@0.1.0
**Exemplary Rating:** ⭐⭐⭐⭐⭐ (Reference Implementation)

