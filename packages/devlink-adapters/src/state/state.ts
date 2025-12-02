import { readJson, writeJson, exists } from '../filesystem/fs';
import type { DevlinkState } from '../types';
import { logger } from '../logging/logger';

const STATE_PATH = '.kb/devlink/state.json';

export async function loadState(cwd = process.cwd()): Promise<DevlinkState | null> {
  const p = `${cwd}/${STATE_PATH}`;
  if (!(await exists(p))) { return null; }
  try {
    const s = await readJson<DevlinkState>(p);
    return s;
  } catch (e) {
    logger.warn('failed to read state.json', (e as Error).message);
    return null;
  }
}

export async function saveState(state: DevlinkState, cwd = process.cwd()) {
  const p = `${cwd}/${STATE_PATH}`;
  await writeJson(p, state);
  logger.debug('state saved', { path: p, pkgs: state.packages.length, deps: state.deps.length });
}