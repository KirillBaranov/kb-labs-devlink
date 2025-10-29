/**
 * Tests for artifact detection functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { 
  findYalcArtifacts, 
  detectProtocolConflicts, 
  detectStaleArtifacts 
} from '../devlink/artifacts';

describe('Artifact Detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `devlink-artifacts-test-${Date.now()}`);
    await fsp.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  describe('findYalcArtifacts', () => {
    it('should find root level yalc artifacts', async () => {
      await fsp.writeFile(join(tempDir, 'yalc.lock'), '{}');
      await fsp.mkdir(join(tempDir, '.yalc'), { recursive: true });

      const artifacts = await findYalcArtifacts(tempDir);

      expect(artifacts).toContain('yalc.lock');
      expect(artifacts).toContain('.yalc');
    });

    it('should find package level yalc artifacts', async () => {
      const packageDir = join(tempDir, 'packages', 'test-package');
      await fsp.mkdir(packageDir, { recursive: true });
      await fsp.writeFile(join(packageDir, 'yalc.lock'), '{}');
      await fsp.mkdir(join(packageDir, '.yalc'), { recursive: true });

      const artifacts = await findYalcArtifacts(tempDir);

      expect(artifacts).toContain('packages/test-package/yalc.lock');
      expect(artifacts).toContain('packages/test-package/.yalc');
    });

    it('should find app level yalc artifacts', async () => {
      const appDir = join(tempDir, 'apps', 'test-app');
      await fsp.mkdir(appDir, { recursive: true });
      await fsp.writeFile(join(appDir, 'yalc.lock'), '{}');
      await fsp.mkdir(join(appDir, '.yalc'), { recursive: true });

      const artifacts = await findYalcArtifacts(tempDir);

      expect(artifacts).toContain('apps/test-app/yalc.lock');
      expect(artifacts).toContain('apps/test-app/.yalc');
    });

    it('should return empty array when no artifacts found', async () => {
      const artifacts = await findYalcArtifacts(tempDir);
      expect(artifacts).toEqual([]);
    });
  });

  describe('detectProtocolConflicts', () => {
    it('should detect protocol conflicts in package.json', async () => {
      const packageDir = join(tempDir, 'packages', 'test-package');
      await fsp.mkdir(packageDir, { recursive: true });
      
      await fsp.writeFile(
        join(packageDir, 'package.json'),
        JSON.stringify({
          name: '@test/package',
          version: '1.0.0',
          dependencies: {
            '@test/dep1': 'link:../dep1',
            '@test/dep2': 'workspace:*',
          },
          devDependencies: {
            '@test/dep1': '^1.0.0', // Conflict: same package, different protocols
          },
        })
      );

      const conflicts = await detectProtocolConflicts(tempDir);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].package).toBe('@test/dep1');
      expect(conflicts[0].protocols).toContain('link');
      expect(conflicts[0].protocols).toContain('npm');
    });

    it('should not detect conflicts for different packages', async () => {
      const packageDir = join(tempDir, 'packages', 'test-package');
      await fsp.mkdir(packageDir, { recursive: true });
      
      await fsp.writeFile(
        join(packageDir, 'package.json'),
        JSON.stringify({
          name: '@test/package',
          version: '1.0.0',
          dependencies: {
            '@test/dep1': 'link:../dep1',
            '@test/dep2': 'workspace:*',
          },
        })
      );

      const conflicts = await detectProtocolConflicts(tempDir);

      expect(conflicts).toHaveLength(0);
    });

    it('should handle malformed package.json gracefully', async () => {
      const packageDir = join(tempDir, 'packages', 'test-package');
      await fsp.mkdir(packageDir, { recursive: true });
      
      await fsp.writeFile(join(packageDir, 'package.json'), 'invalid json');

      const conflicts = await detectProtocolConflicts(tempDir);

      expect(conflicts).toHaveLength(0);
    });
  });

  describe('detectStaleArtifacts', () => {
    it('should detect both yalc artifacts and protocol conflicts', async () => {
      // Create yalc artifacts
      await fsp.writeFile(join(tempDir, 'yalc.lock'), '{}');
      
      // Create package with protocol conflicts
      const packageDir = join(tempDir, 'packages', 'test-package');
      await fsp.mkdir(packageDir, { recursive: true });
      
      await fsp.writeFile(
        join(packageDir, 'package.json'),
        JSON.stringify({
          name: '@test/package',
          version: '1.0.0',
          dependencies: {
            '@test/dep1': 'link:../dep1',
          },
          devDependencies: {
            '@test/dep1': '^1.0.0',
          },
        })
      );

      const artifacts = await detectStaleArtifacts(tempDir);

      expect(artifacts.yalc).toContain('yalc.lock');
      expect(artifacts.conflicts).toHaveLength(1);
      expect(artifacts.conflicts[0].package).toBe('@test/dep1');
    });

    it('should return empty arrays when no artifacts found', async () => {
      const artifacts = await detectStaleArtifacts(tempDir);

      expect(artifacts.yalc).toEqual([]);
      expect(artifacts.conflicts).toEqual([]);
    });
  });
});
