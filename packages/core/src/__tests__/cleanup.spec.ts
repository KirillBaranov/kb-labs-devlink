/**
 * Tests for cleanup functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { clean } from '../clean';

describe('Cleanup', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `devlink-cleanup-test-${Date.now()}`);
    await fsp.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('should clean basic devlink artifacts', async () => {
    // Create devlink artifacts
    const devlinkDir = join(tempDir, '.kb', 'devlink');
    await fsp.mkdir(devlinkDir, { recursive: true });
    
    await fsp.writeFile(join(devlinkDir, 'state.json'), '{}');
    await fsp.writeFile(join(devlinkDir, 'plan.json'), '{}');
    await fsp.writeFile(join(devlinkDir, 'lock.json'), '{}');
    
    // Create tmp and backup dirs
    await fsp.mkdir(join(devlinkDir, 'tmp'), { recursive: true });
    await fsp.mkdir(join(devlinkDir, 'backup'), { recursive: true });
    await fsp.writeFile(join(devlinkDir, 'tmp', 'test.txt'), 'test');
    await fsp.writeFile(join(devlinkDir, 'backup', 'test.txt'), 'test');

    const result = await clean(tempDir, { hard: false, deep: false });

    expect(result.removed).toContain('state.json');
    expect(result.removed).toContain('plan.json');
    expect(result.removed).toContain('tmp');
    expect(result.removed).toContain('backup');
    expect(result.removed).not.toContain('lock.json');
  });

  it('should clean yalc artifacts', async () => {
    // Create yalc artifacts
    await fsp.writeFile(join(tempDir, 'yalc.lock'), '{}');
    await fsp.mkdir(join(tempDir, '.yalc'), { recursive: true });
    await fsp.writeFile(join(tempDir, '.yalc', 'test.json'), '{}');

    // Create package with yalc artifacts
    const packageDir = join(tempDir, 'packages', 'test-package');
    await fsp.mkdir(packageDir, { recursive: true });
    await fsp.writeFile(join(packageDir, 'yalc.lock'), '{}');
    await fsp.mkdir(join(packageDir, '.yalc'), { recursive: true });

    const result = await clean(tempDir, { hard: false, deep: false });

    expect(result.removed).toContain('yalc.lock');
    expect(result.removed).toContain('.yalc');
    expect(result.removed).toContain('packages/test-package/yalc.lock');
    expect(result.removed).toContain('packages/test-package/.yalc');
  });

  it('should clean with hard mode', async () => {
    // Create devlink artifacts including lock
    const devlinkDir = join(tempDir, '.kb', 'devlink');
    await fsp.mkdir(devlinkDir, { recursive: true });
    await fsp.writeFile(join(devlinkDir, 'lock.json'), '{}');

    const result = await clean(tempDir, { hard: true, deep: false });

    expect(result.removed).toContain('lock.json');
  });

  it('should handle missing files gracefully', async () => {
    // Create only the base directory structure
    const devlinkDir = join(tempDir, '.kb', 'devlink');
    await fsp.mkdir(devlinkDir, { recursive: true });
    
    const result = await clean(tempDir, { hard: false, deep: false });

    // Should still clean the base artifacts that exist
    expect(result.removed).toContain('tmp');
    expect(result.removed).toContain('backup');
    expect(result.removed).toContain('plan.json');
    expect(result.removed).toContain('state.json');
  });

  it('should clean apps directory artifacts', async () => {
    // Create app with yalc artifacts
    const appDir = join(tempDir, 'apps', 'test-app');
    await fsp.mkdir(appDir, { recursive: true });
    await fsp.writeFile(join(appDir, 'yalc.lock'), '{}');
    await fsp.mkdir(join(appDir, '.yalc'), { recursive: true });

    const result = await clean(tempDir, { hard: false, deep: false });

    expect(result.removed).toContain('apps/test-app/yalc.lock');
    expect(result.removed).toContain('apps/test-app/.yalc');
  });
});
