type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const env = (process.env.KB_DEVLINK_LOG_LEVEL || 'info') as Level;

function fmt(level: Level, msg: string, extra?: unknown) {
  const time = new Date().toISOString();
  if (extra === undefined) { return `[devlink] ${time} ${level.toUpperCase()} ${msg}`; }
  return `[devlink] ${time} ${level.toUpperCase()} ${msg} ${JSON.stringify(extra)}`;
}

export const logger = {
  level: env,
  debug(msg: string, extra?: unknown) {
    if (LEVELS[this.level] <= LEVELS.debug) { console.debug(fmt('debug', msg, extra)); }
  },
  info(msg: string, extra?: unknown) {
    if (LEVELS[this.level] <= LEVELS.info) { console.info(fmt('info', msg, extra)); }
  },
  warn(msg: string, extra?: unknown) {
    if (LEVELS[this.level] <= LEVELS.warn) { console.warn(fmt('warn', msg, extra)); }
  },
  error(msg: string, extra?: unknown) {
    console.error(fmt('error', msg, extra));
  },
};