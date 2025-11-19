export type CommandModule<Flags = Record<string, unknown>> = {
  run: (ctx: any, argv: string[], flags: Flags) => Promise<number | void>;
};
