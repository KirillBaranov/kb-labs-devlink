import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import os from 'os';
import { handlePlan } from '../handlers/plan-handler';
import { clearPlanDtoCache } from '../plan-dto';

const FIXTURE_PATH = join(__dirname, '../__fixtures__/last-plan.sample.json');

describe('handlePlan', () => {
  let tmpDir: string;

  beforeEach(async () => {
    clearPlanDtoCache();
    tmpDir = await fsp.mkdtemp(join(os.tmpdir(), 'devlink-plan-handler-'));
    const planDir = join(tmpDir, '.kb/devlink');
    await fsp.mkdir(planDir, { recursive: true });
    const content = await fsp.readFile(FIXTURE_PATH, 'utf8');
    await fsp.writeFile(join(planDir, 'last-plan.json'), content, 'utf8');
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns DTO when plan exists', async () => {
    const result = await handlePlan(
      { cwd: tmpDir },
      {
        requestId: 'test-1',
        pluginId: '@kb-labs/devlink',
        workdir: tmpDir,
        runtime: {
          log: () => undefined,
        },
      }
    );

    expect((result as any).summary).toBeDefined();
    expect((result as any).summary.packageCount).toBe(3);
  });

  it('walks up from nested workdir when cwd not provided', async () => {
    const nestedWorkdir = join(tmpDir, 'packages/core/dist');
    await fsp.mkdir(nestedWorkdir, { recursive: true });

    const result = await handlePlan(
      {},
      {
        requestId: 'test-3',
        pluginId: '@kb-labs/devlink',
        workdir: nestedWorkdir,
        runtime: {
          log: () => undefined,
        },
      }
    );

    expect((result as any).summary.packageCount).toBe(3);
  });

  it('returns widget-specific payload when view query provided', async () => {
    const result = await handlePlan(
      { view: 'overview' },
      {
        requestId: 'test-4',
        pluginId: '@kb-labs/devlink',
        workdir: tmpDir,
        runtime: {
          log: () => undefined,
        },
      }
    );

    expect((result as any).sections).toBeDefined();
  });

  it('returns error when view is unknown', async () => {
    const result = await handlePlan(
      { view: 'unknown.view' },
      {
        requestId: 'test-5',
        pluginId: '@kb-labs/devlink',
        workdir: tmpDir,
        runtime: {
          log: () => undefined,
        },
      }
    );

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        code: 'DEVLINK_PLAN_WIDGET_UNKNOWN',
      })
    );
  });

  it('resolves root from KB_LABS_REPO_ROOT env when provided', async () => {
    const result = await handlePlan(
      {},
      {
        requestId: 'env-test',
        pluginId: '@kb-labs/devlink',
        workdir: undefined,
        runtime: {
          log: () => undefined,
          env: (key) => (key === 'KB_LABS_REPO_ROOT' ? tmpDir : undefined),
        },
      }
    );

    expect((result as any).summary.packageCount).toBe(3);
  });

  it('falls back to process.cwd when no hints provided', async () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    try {
      const result = await handlePlan(
        {},
        {
          requestId: 'test-6',
          pluginId: '@kb-labs/devlink',
          workdir: undefined,
          runtime: {
            log: () => undefined,
          },
        }
      );

      expect((result as any).summary.packageCount).toBe(3);
    } finally {
      cwdSpy.mockRestore();
    }
  });
});
