import { promises as fsp } from 'fs';
import { join } from 'path';
import { logger } from '../utils/logger';

export async function rollback(cwd = process.cwd(), id?: string) {
  const base = join(cwd, '.kb', 'devlink', 'backup');
  const entries = await fsp.readdir(base).catch(() => []);
  if (!entries.length) {
    logger.warn('no backups to rollback');
    return;
  }
  const restore = id ? id : entries.sort().reverse()[0];
  const folder = join(base, restore);
  const files = await fsp.readdir(folder).catch(() => []);
  for (const f of files) {
    // в бэкапе хранить относительные пути к корню
    const src = join(folder, f);
    const dst = join(cwd, f);
    const data = await fsp.readFile(src);
    await fsp.mkdir(require('path').dirname(dst), { recursive: true });
    await fsp.writeFile(dst, data);
  }
  logger.info('rollback restored', { backup: restore, files: files.length });
}