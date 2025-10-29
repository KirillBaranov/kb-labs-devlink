/**
 * Tests for auto mode functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildPlan } from '../devlink/plan';
import { scanPackages } from '../devlink/scan';
import type { DevLinkMode } from '../devlink/types';

describe('Auto Mode', () => {
  let tempDir: string;
  let packageA: string;
  let packageB: string;
  let packageC: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `devlink-auto-test-${Date.now()}`);
    await fsp.mkdir(tempDir, { recursive: true });

    // Create root package.json for workspace
    await fsp.writeFile(
      join(tempDir, 'package.json'),
      JSON.stringify({
        name: 'test-workspace',
        version: '1.0.0',
        private: true,
        workspaces: ['packages/*'],
      })
    );

    // Create package A (same repo)
    packageA = join(tempDir, 'packages', 'package-a');
    await fsp.mkdir(packageA, { recursive: true });
    await fsp.writeFile(
      join(packageA, 'package.json'),
      JSON.stringify({
        name: '@test/package-a',
        version: '1.0.0',
        dependencies: {
          '@test/package-b': '^1.0.0',
        },
      })
    );

    // Create package B (same repo)
    packageB = join(tempDir, 'packages', 'package-b');
    await fsp.mkdir(packageB, { recursive: true });
    await fsp.writeFile(
      join(packageB, 'package.json'),
      JSON.stringify({
        name: '@test/package-b',
        version: '1.0.0',
      })
    );

    // Create package C (external repo)
    packageC = join(tempDir, 'external', 'package-c');
    await fsp.mkdir(packageC, { recursive: true });
    await fsp.writeFile(
      join(packageC, 'package.json'),
      JSON.stringify({
        name: '@test/package-c',
        version: '1.0.0',
      })
    );
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('should use workspace protocol for same-repo packages in auto mode', async () => {
    // Test the auto mode logic directly by creating a mock scenario
    const mockIndex = {
      rootDir: tempDir,
      packages: {
        '@test/package-a': {
          name: '@test/package-a',
          version: '1.0.0',
          dir: packageA,
          rootDir: tempDir, // Same root directory
          dependencies: { '@test/package-b': '^1.0.0' },
        },
        '@test/package-b': {
          name: '@test/package-b',
          version: '1.0.0',
          dir: packageB,
          rootDir: tempDir, // Same root directory
          dependencies: {},
        },
      },
    };

    const mockGraph = {
      edges: [
        {
          from: '@test/package-a',
          to: '@test/package-b',
          kind: 'dependency',
        },
      ],
      cycles: [],
    };
    
    const plan = await buildPlan(mockIndex as any, mockGraph as any, {
      mode: 'auto' as DevLinkMode,
      policy: {},
    });

    // Find the action for package-a -> package-b (same repo)
    const sameRepoAction = plan.actions.find(
      a => a.target === '@test/package-a' && a.dep === '@test/package-b'
    );

    expect(sameRepoAction).toBeDefined();
    expect(sameRepoAction?.kind).toBe('use-workspace');
    expect(sameRepoAction?.reason).toContain('auto: same monorepo');
  });

  it('should use link protocol for cross-repo packages in auto mode', async () => {
    // Test cross-repo scenario
    const mockIndex = {
      rootDir: tempDir,
      packages: {
        '@test/package-a': {
          name: '@test/package-a',
          version: '1.0.0',
          dir: packageA,
          rootDir: tempDir, // Same root directory
          dependencies: { '@test/package-c': '^1.0.0' },
        },
        '@test/package-c': {
          name: '@test/package-c',
          version: '1.0.0',
          dir: packageC,
          rootDir: join(tempDir, 'external'), // Different root directory
          dependencies: {},
        },
      },
    };

    const mockGraph = {
      edges: [
        {
          from: '@test/package-a',
          to: '@test/package-c',
          kind: 'dependency',
        },
      ],
      cycles: [],
    };
    
    const plan = await buildPlan(mockIndex as any, mockGraph as any, {
      mode: 'auto' as DevLinkMode,
      policy: {},
    });

    // Find any cross-repo actions
    const crossRepoActions = plan.actions.filter(
      a => a.reason?.includes('auto: cross-repo')
    );

    expect(crossRepoActions.length).toBeGreaterThan(0);
    crossRepoActions.forEach(action => {
      expect(action.kind).toBe('link-local');
    });
  });

  it('should handle mixed dependencies correctly', async () => {
    // Test mixed scenario with both same-repo and cross-repo dependencies
    const mockIndex = {
      rootDir: tempDir,
      packages: {
        '@test/package-a': {
          name: '@test/package-a',
          version: '1.0.0',
          dir: packageA,
          rootDir: tempDir, // Same root directory
          dependencies: { 
            '@test/package-b': '^1.0.0',
            '@test/package-c': '^1.0.0',
          },
        },
        '@test/package-b': {
          name: '@test/package-b',
          version: '1.0.0',
          dir: packageB,
          rootDir: tempDir, // Same root directory
          dependencies: {},
        },
        '@test/package-c': {
          name: '@test/package-c',
          version: '1.0.0',
          dir: packageC,
          rootDir: join(tempDir, 'external'), // Different root directory
          dependencies: {},
        },
      },
    };

    const mockGraph = {
      edges: [
        {
          from: '@test/package-a',
          to: '@test/package-b',
          kind: 'dependency',
        },
        {
          from: '@test/package-a',
          to: '@test/package-c',
          kind: 'dependency',
        },
      ],
      cycles: [],
    };
    
    const plan = await buildPlan(mockIndex as any, mockGraph as any, {
      mode: 'auto' as DevLinkMode,
      policy: {},
    });

    const actions = plan.actions.filter(
      a => a.target === '@test/package-a'
    );

    expect(actions).toHaveLength(2);
    
    const workspaceAction = actions.find(a => a.dep === '@test/package-b');
    const linkAction = actions.find(a => a.dep === '@test/package-c');

    expect(workspaceAction?.kind).toBe('use-workspace');
    expect(linkAction?.kind).toBe('link-local');
  });
});
