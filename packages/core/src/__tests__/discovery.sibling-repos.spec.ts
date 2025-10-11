import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdtemp, rm, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { discover } from "../discovery";
import {
  detectWorkspaceContainerRoots,
  isMonorepoRoot,
  findChildRepoRoots
} from "../discovery/workspace";

describe("Discovery: Workspace Detection & Sibling Repos", () => {
  let tmpParent: string;
  let repo1Dir: string;
  let repo2Dir: string;
  let repo3Dir: string;

  beforeEach(async () => {
    // Create parent directory that will contain multiple repos
    tmpParent = await mkdtemp(join(tmpdir(), "devlink-sibling-test-"));

    // Create repo1 (simple repo without packages/* or apps/*)
    repo1Dir = join(tmpParent, "repo1");
    await mkdir(repo1Dir, { recursive: true });
    await writeFile(
      join(repo1Dir, "package.json"),
      JSON.stringify({
        name: "@org/repo1",
        version: "1.0.0",
        dependencies: {
          "@org/repo2": "^1.0.0",
        },
      }, null, 2)
    );

    // Create repo2 (another simple repo)
    repo2Dir = join(tmpParent, "repo2");
    await mkdir(repo2Dir, { recursive: true });
    await writeFile(
      join(repo2Dir, "package.json"),
      JSON.stringify({
        name: "@org/repo2",
        version: "1.0.0",
        dependencies: {},
      }, null, 2)
    );

    // Create repo3 (third repo with dependency on repo1)
    repo3Dir = join(tmpParent, "repo3");
    await mkdir(repo3Dir, { recursive: true });
    await writeFile(
      join(repo3Dir, "package.json"),
      JSON.stringify({
        name: "@org/repo3",
        version: "1.0.0",
        dependencies: {
          "@org/repo1": "^1.0.0",
          "lodash": "^4.0.0",
        },
      }, null, 2)
    );
  });

  afterEach(async () => {
    await rm(tmpParent, { recursive: true, force: true });
  });

  it("should auto-discover sibling repos when no packages/* or apps/* exist", async () => {
    // Change to repo1 directory to simulate running from there
    const originalCwd = process.cwd();
    process.chdir(repo1Dir);

    try {
      // Discover without explicit roots - should auto-find siblings
      const state = await discover({});

      // Should have found all 3 repos
      expect(state.packages.length).toBe(3);

      const packageNames = state.packages.map(p => p.name).sort();
      expect(packageNames).toEqual(["@org/repo1", "@org/repo2", "@org/repo3"]);

      // Should have captured dependencies
      expect(state.deps.length).toBeGreaterThan(0);

      // Should have dependency from repo1 to repo2
      const dep1to2 = state.deps.find(d => d.from === "@org/repo1" && d.to === "@org/repo2");
      expect(dep1to2).toBeDefined();

      // Should have dependency from repo3 to repo1
      const dep3to1 = state.deps.find(d => d.from === "@org/repo3" && d.to === "@org/repo1");
      expect(dep3to1).toBeDefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should NOT auto-discover siblings when packages/* exists", async () => {
    // Add packages/* to repo1 to make it a monorepo
    const pkgADir = join(repo1Dir, "packages", "pkg-a");
    await mkdir(pkgADir, { recursive: true });
    await writeFile(
      join(pkgADir, "package.json"),
      JSON.stringify({
        name: "@org/pkg-a",
        version: "1.0.0",
      }, null, 2)
    );

    const originalCwd = process.cwd();
    process.chdir(repo1Dir);

    try {
      const state = await discover({});

      // Should find repo1 root + pkg-a, but NOT sibling repos
      expect(state.packages.length).toBe(2);

      const packageNames = state.packages.map(p => p.name).sort();
      expect(packageNames).toEqual(["@org/pkg-a", "@org/repo1"]);

      // Should NOT include @org/repo2 or @org/repo3
      expect(packageNames).not.toContain("@org/repo2");
      expect(packageNames).not.toContain("@org/repo3");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should NOT auto-discover when explicit roots are provided", async () => {
    const originalCwd = process.cwd();
    process.chdir(repo1Dir);

    try {
      // Explicitly provide only repo1 and repo2
      const state = await discover({
        roots: [repo1Dir, repo2Dir],
      });

      // Should find only specified repos, not auto-discover repo3
      expect(state.packages.length).toBe(2);

      const packageNames = state.packages.map(p => p.name).sort();
      expect(packageNames).toEqual(["@org/repo1", "@org/repo2"]);
      expect(packageNames).not.toContain("@org/repo3");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should handle sibling repos with monorepo structure", async () => {
    // Create a sibling monorepo with packages/*
    const monorepoDir = join(tmpParent, "monorepo");
    await mkdir(join(monorepoDir, "packages", "lib-a"), { recursive: true });
    await writeFile(
      join(monorepoDir, "package.json"),
      JSON.stringify({
        name: "@org/monorepo-root",
        version: "1.0.0",
        private: true,
      }, null, 2)
    );
    await writeFile(
      join(monorepoDir, "packages", "lib-a", "package.json"),
      JSON.stringify({
        name: "@org/lib-a",
        version: "1.0.0",
        dependencies: {
          "@org/repo2": "^1.0.0",
        },
      }, null, 2)
    );

    const originalCwd = process.cwd();
    process.chdir(repo1Dir);

    try {
      const state = await discover({});

      // Should find:
      // - repo1, repo2, repo3 (siblings)
      // - monorepo root + lib-a
      expect(state.packages.length).toBeGreaterThanOrEqual(4);

      const packageNames = state.packages.map(p => p.name);
      expect(packageNames).toContain("@org/repo1");
      expect(packageNames).toContain("@org/repo2");
      expect(packageNames).toContain("@org/repo3");
      expect(packageNames).toContain("@org/lib-a");

      // Should have cross-repo dependency from lib-a to repo2
      const depLibToRepo2 = state.deps.find(
        d => d.from === "@org/lib-a" && d.to === "@org/repo2"
      );
      expect(depLibToRepo2).toBeDefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should deduplicate packages when found in multiple sibling repos", async () => {
    // Create two repos with same package name (edge case)
    const duplicateDir = join(tmpParent, "duplicate");
    await mkdir(duplicateDir, { recursive: true });
    await writeFile(
      join(duplicateDir, "package.json"),
      JSON.stringify({
        name: "@org/repo1", // Same name as repo1!
        version: "2.0.0",   // Different version
      }, null, 2)
    );

    const originalCwd = process.cwd();
    process.chdir(repo1Dir);

    try {
      const state = await discover({});

      // Should deduplicate and prefer the one from current cwd
      const repo1Packages = state.packages.filter(p => p.name === "@org/repo1");
      expect(repo1Packages).toHaveLength(1);

      // Should prefer the one from current working directory (repo1Dir)
      // Version check is sufficient - cwd version should win
      expect(repo1Packages[0]!.version).toBe("1.0.0");
      expect(repo1Packages[0]!.pathAbs).toContain("repo1");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should work from parent directory and discover all child repos", async () => {
    // When running from parent, explicitly pass child repos as roots
    // (parent itself may not have buckets, so auto-discovery would look up one level)
    const originalCwd = process.cwd();
    process.chdir(tmpParent);

    try {
      const state = await discover({
        roots: [repo1Dir, repo2Dir, repo3Dir],
      });

      // Should discover all explicitly provided repos
      expect(state.packages.length).toBe(3);

      const packageNames = state.packages.map(p => p.name);
      expect(packageNames).toContain("@org/repo1");
      expect(packageNames).toContain("@org/repo2");
      expect(packageNames).toContain("@org/repo3");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should handle empty sibling directories gracefully", async () => {
    // Create an empty directory that's not a repo
    const emptyDir = join(tmpParent, "empty-folder");
    await mkdir(emptyDir, { recursive: true });

    // Create a directory with invalid package.json
    const invalidDir = join(tmpParent, "invalid-repo");
    await mkdir(invalidDir, { recursive: true });
    await writeFile(
      join(invalidDir, "package.json"),
      "{ invalid json }"
    );

    const originalCwd = process.cwd();
    process.chdir(repo1Dir);

    try {
      const state = await discover({});

      // Should still work and find valid repos
      expect(state.packages.length).toBeGreaterThanOrEqual(3);

      const packageNames = state.packages.map(p => p.name);
      expect(packageNames).toContain("@org/repo1");
      expect(packageNames).toContain("@org/repo2");

      // Should NOT include invalid or empty dirs
      expect(packageNames.every(n => n.startsWith("@org/"))).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should handle deeply nested monorepos in sibling discovery", async () => {
    // Create a sibling with apps/* structure
    const appRepoDir = join(tmpParent, "app-repo");
    await mkdir(join(appRepoDir, "apps", "web"), { recursive: true });
    await writeFile(
      join(appRepoDir, "package.json"),
      JSON.stringify({
        name: "@org/app-repo-root",
        version: "1.0.0",
        private: true,
      }, null, 2)
    );
    await writeFile(
      join(appRepoDir, "apps", "web", "package.json"),
      JSON.stringify({
        name: "@org/web-app",
        version: "1.0.0",
        dependencies: {
          "@org/repo1": "^1.0.0",
        },
      }, null, 2)
    );

    const originalCwd = process.cwd();
    process.chdir(repo1Dir);

    try {
      const state = await discover({});

      // Should find all packages including those in apps/*
      const packageNames = state.packages.map(p => p.name);
      expect(packageNames).toContain("@org/web-app");
      expect(packageNames).toContain("@org/app-repo-root");

      // Should capture cross-repo dependency
      const depWebToRepo1 = state.deps.find(
        d => d.from === "@org/web-app" && d.to === "@org/repo1"
      );
      expect(depWebToRepo1).toBeDefined();
    } finally {
      process.chdir(originalCwd);
    }
  });

  describe("Workspace Container Detection", () => {
    it("should detect workspace container with multiple child repos", async () => {
      // tmpParent has 3 child repos
      const containerChildren = await detectWorkspaceContainerRoots(tmpParent);

      expect(containerChildren.length).toBeGreaterThanOrEqual(3);
      expect(containerChildren).toContain(repo1Dir);
      expect(containerChildren).toContain(repo2Dir);
      expect(containerChildren).toContain(repo3Dir);
    });

    it("should NOT detect container when only 1 child repo", async () => {
      const singleParent = await mkdtemp(join(tmpdir(), "single-repo-"));
      const singleRepo = join(singleParent, "repo");
      await mkdir(singleRepo, { recursive: true });
      await writeFile(
        join(singleRepo, "package.json"),
        JSON.stringify({ name: "@test/single", version: "1.0.0" }, null, 2)
      );

      const containerChildren = await detectWorkspaceContainerRoots(singleParent);
      expect(containerChildren).toHaveLength(0);

      await rm(singleParent, { recursive: true, force: true });
    });

    it("should NOT detect container when it is a monorepo itself", async () => {
      // Add packages/* to tmpParent
      const pkgDir = join(tmpParent, "packages", "lib");
      await mkdir(pkgDir, { recursive: true });
      await writeFile(
        join(pkgDir, "package.json"),
        JSON.stringify({ name: "@test/lib", version: "1.0.0" }, null, 2)
      );

      const containerChildren = await detectWorkspaceContainerRoots(tmpParent);
      expect(containerChildren).toHaveLength(0); // Not a container, it's a monorepo
    });

    it("isMonorepoRoot should detect packages/* or apps/*", async () => {
      // repo1 without packages/* - not a monorepo
      expect(await isMonorepoRoot(repo1Dir)).toBe(false);

      // Create packages/* in repo1
      await mkdir(join(repo1Dir, "packages"), { recursive: true });
      expect(await isMonorepoRoot(repo1Dir)).toBe(true);
    });

    it("findChildRepoRoots should find all valid repos in directory", async () => {
      const children = await findChildRepoRoots(tmpParent);

      expect(children.length).toBeGreaterThanOrEqual(3);
      expect(children).toContain(repo1Dir);
      expect(children).toContain(repo2Dir);
      expect(children).toContain(repo3Dir);
    });

    it("should handle container scenario in discovery", async () => {
      // When running from tmpParent with multiple child repos
      const originalCwd = process.cwd();
      process.chdir(tmpParent);

      try {
        const state = await discover({});

        // Should detect container and scan all children
        expect(state.packages.length).toBeGreaterThanOrEqual(3);

        const packageNames = state.packages.map(p => p.name);
        expect(packageNames).toContain("@org/repo1");
        expect(packageNames).toContain("@org/repo2");
        expect(packageNames).toContain("@org/repo3");
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

