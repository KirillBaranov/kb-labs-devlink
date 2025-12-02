import type { ZodSchema, ZodError } from 'zod';

interface Presenter {
  json: (payload: unknown) => void;
  error: (message: string) => void;
}

interface CommandContext {
  presenter: Presenter;
}

interface ParseFlagsOptions {
  ctx: CommandContext;
  command: string;
  jsonMode: boolean;
}

function formatIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export function parseCommandFlags<T>(
  schema: ZodSchema<T>,
  rawFlags: unknown,
  { ctx, command, jsonMode }: ParseFlagsOptions,
): T | undefined {
  const result = schema.safeParse(rawFlags);
  if (result.success) {
    return result.data;
  }

  const message = formatIssues(result.error);
  if (jsonMode) {
    ctx.presenter.json({
      ok: false,
      error: `Invalid flags for ${command}`,
      issues: result.error.issues,
    });
  } else {
    ctx.presenter.error(`Invalid flags for ${command}: ${message}`);
  }

  return undefined;
}


