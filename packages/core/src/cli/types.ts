export type CommandModule = {
  run: (ctx: any, argv: string[], flags: Record<string, any>) => Promise<number | void>;
};
