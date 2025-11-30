import { describe, it, expect, beforeEach, vi } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import os from 'os';
import { loadPlanDTO, clearPlanDtoCache } from '../plan-dto';

const FIXTURE_PATH = join(__dirname, '../__fixtures__/last-plan.sample.json');
const ROOT_DIR = '/workspace/repo';

describe('loadPlanDTO', () => {
  beforeEach(() => {
    clearPlanDtoCache();
  });

  it('returns summary and nodes based on plan data', async () => {
    const dto = await loadPlanDTO(ROOT_DIR, { planPath: FIXTURE_PATH });

    expect(dto.summary.packageCount).toBe(3);
    expect(dto.summary.actionCount).toBe(2);
    expect(dto.summary.actionsByKind['link-local']).toBe(1);
    expect(dto.summary.actionsByKind['use-npm']).toBe(1);
    expect(dto.nodes).toHaveLength(3);

    const packageANode = dto.nodes.find((node) => node.id === 'package-a');
    expect(packageANode).toBeDefined();
    expect(packageANode!.actionCounts.total).toBe(1);
    expect(packageANode!.dependencyCounts.outgoing).toBe(1);

    const externalNode = dto.nodes.find((node) => node.id === 'external-lib');
    expect(externalNode).toBeDefined();
    expect(externalNode!.hasLocalPackage).toBe(false);
    expect(dto.meta.hash).toHaveLength(40);
    expect(dto.meta.sourcePath).toBe(FIXTURE_PATH);
    expect((dto.widgets.overview.infoPanel?.sections ?? []).length).toBeGreaterThan(0);
    const firstChart = dto.widgets.overview.actionsChart?.[0];
    expect(firstChart).toBeDefined();
    expect((firstChart?.points ?? []).length).toBeGreaterThan(0);
    expect(dto.widgets.dependencies.packagesTable.length).toBe(3);
    expect(dto.widgets.dependencies.repoTree.label).toBe('repo');
  });

  it('caches DTO based on file hash', async () => {
    const readSpy = vi.spyOn(fsp, 'readFile');

    await loadPlanDTO(ROOT_DIR, { planPath: FIXTURE_PATH });
    await loadPlanDTO(ROOT_DIR, { planPath: FIXTURE_PATH });

    expect(readSpy).toHaveBeenCalledTimes(1);
    readSpy.mockRestore();
  });

  it('refreshes cache when file content changes', async () => {
    const tmpDir = await fsp.mkdtemp(join(os.tmpdir(), 'devlink-plan-'));
    const tmpPlanPath = join(tmpDir, 'last-plan.json');

    const initialContent = await fsp.readFile(FIXTURE_PATH, 'utf8');
    await fsp.writeFile(tmpPlanPath, initialContent, 'utf8');

    const firstDto = await loadPlanDTO(ROOT_DIR, { planPath: tmpPlanPath });
    expect(firstDto.summary.actionCount).toBe(2);

    const parsed = JSON.parse(initialContent);
    parsed.actions.push({
      target: 'package-a',
      dep: 'external-lib',
      kind: 'use-npm',
      reason: 'test modification',
      from: '^1.0.0',
      to: '^1.0.0',
    });
    await fsp.writeFile(tmpPlanPath, JSON.stringify(parsed, null, 2), 'utf8');

    const updatedDto = await loadPlanDTO(ROOT_DIR, { planPath: tmpPlanPath });
    expect(updatedDto.summary.actionCount).toBe(3);
    expect(updatedDto.meta.hash).not.toBe(firstDto.meta.hash);
  });
});
