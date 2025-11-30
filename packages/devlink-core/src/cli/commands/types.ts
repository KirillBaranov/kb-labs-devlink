import type { PluginContext } from '@kb-labs/plugin-runtime';

export type CommandModule<Flags = Record<string, unknown>> = {
  run: (ctx: PluginContext, argv: string[], flags: Flags) => Promise<number | void>;
};
