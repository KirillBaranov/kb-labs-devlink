import { promises as fsp } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

export async function removeIfExists(p: string) {
  try {
    await fsp.rm(p, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function clean(cwd = process.cwd(), hard = false) {
  const base = join(cwd, '.kb', 'devlink');
  const removed = [];
  for (const rel of ['tmp', 'backup', 'plan.json', 'state.json']) {
    const ok = await removeIfExists(join(base, rel));
    if (ok) { removed.push(rel); }
  }
  // часто lockfile у yalc:
  await removeIfExists(join(cwd, 'yalc.lock'));
  if (hard) {
    await removeIfExists(join(base, 'lock.json'));
  }
  logger.info('clean finished', { removed, hard });
}