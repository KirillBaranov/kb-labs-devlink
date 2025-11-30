import { promises as fsp } from 'fs';
import { join } from 'path';
// Note: glob is imported dynamically to avoid build issues
import { logger } from '../logging/logger';

export async function removeIfExists(p: string) {
  try {
    await fsp.rm(p, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export interface CleanOptions {
  hard?: boolean;
  deep?: boolean;
}

export async function clean(cwd = process.cwd(), opts: CleanOptions = {}) {
  const base = join(cwd, '.kb', 'devlink');
  const removed = [];
  
  // Clean devlink artifacts
  for (const rel of ['tmp', 'backup', 'plan.json', 'state.json']) {
    const ok = await removeIfExists(join(base, rel));
    if (ok) { removed.push(rel); }
  }
  
  // Clean lock.json only if hard mode
  if (opts.hard) {
    const ok = await removeIfExists(join(base, 'lock.json'));
    if (ok) { removed.push('lock.json'); }
  }
  
  // Clean yalc artifacts
  if (await removeIfExists(join(cwd, 'yalc.lock'))) {
    removed.push('yalc.lock');
  }
  if (await removeIfExists(join(cwd, '.yalc'))) {
    removed.push('.yalc');
  }
  
  // Find all packages and clean their .yalc
  const packagesGlobs = ['packages/*', 'apps/*'];
  for (const pattern of packagesGlobs) {
    try {
      const { glob } = await import('glob');
      const pkgs = await glob(pattern, { cwd });
      for (const pkg of pkgs) {
        const yalcDir = join(cwd, pkg, '.yalc');
        const yalcLock = join(cwd, pkg, 'yalc.lock');
        if (await removeIfExists(yalcDir)) {
          removed.push(`${pkg}/.yalc`);
        }
        if (await removeIfExists(yalcLock)) {
          removed.push(`${pkg}/yalc.lock`);
        }
      }
    } catch (err) {
      // Ignore glob errors
    }
  }
  
  // Deep clean: global yalc store
  if (opts.deep) {
    const os = await import('os');
    const home = os.homedir();
    const globalYalc = join(home, '.yalc');
    if (await removeIfExists(globalYalc)) {
      removed.push('~/.yalc (global)');
  }
  }
  
  
  logger.info('clean finished', { removed, hard: opts.hard, deep: opts.deep });
  
  return { removed };
}