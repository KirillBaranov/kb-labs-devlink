import { describe, it, expect } from "vitest";
import {
  buildReverseDependencyMap,
  getDirectConsumers,
  matchesGlobPatterns,
  filterProviders,
  filterConsumers,
} from "../dependency-resolver";
import type { PackageGraph, PackageIndex } from "../../types";

describe("dependency-resolver", () => {
  describe("buildReverseDependencyMap", () => {
    it("should build reverse dependency map", () => {
      const graph: PackageGraph = {
        nodes: ["pkg-a", "pkg-b", "pkg-c"],
        edges: [
          { from: "pkg-a", to: "pkg-b", type: "dep" }, // A depends on B
          { from: "pkg-c", to: "pkg-b", type: "dep" }, // C depends on B
        ],
        topological: ["pkg-b", "pkg-a", "pkg-c"],
        cycles: [],
      };

      const index: PackageIndex = {
        rootDir: "/test",
        packages: {
          "pkg-a": {
            name: "pkg-a",
            version: "1.0.0",
            dir: "/test/a",
            manifest: {},
            pkg: { name: "pkg-a", version: "1.0.0" },
          },
          "pkg-b": {
            name: "pkg-b",
            version: "1.0.0",
            dir: "/test/b",
            manifest: {},
            pkg: { name: "pkg-b", version: "1.0.0" },
          },
          "pkg-c": {
            name: "pkg-c",
            version: "1.0.0",
            dir: "/test/c",
            manifest: {},
            pkg: { name: "pkg-c", version: "1.0.0" },
          },
        },
        byDir: {},
      };

      const reverseMap = buildReverseDependencyMap(graph, index);

      // pkg-b should have consumers: pkg-a and pkg-c
      expect(reverseMap.get("pkg-b")).toEqual(expect.arrayContaining(["pkg-a", "pkg-c"]));
      expect(reverseMap.get("pkg-b")?.length).toBe(2);

      // pkg-a and pkg-c have no consumers
      expect(reverseMap.get("pkg-a")).toEqual([]);
      expect(reverseMap.get("pkg-c")).toEqual([]);
    });

    it("should handle packages with no dependencies", () => {
      const graph: PackageGraph = {
        nodes: ["pkg-a", "pkg-b"],
        edges: [],
        topological: ["pkg-a", "pkg-b"],
        cycles: [],
      };

      const index: PackageIndex = {
        rootDir: "/test",
        packages: {
          "pkg-a": {
            name: "pkg-a",
            version: "1.0.0",
            dir: "/test/a",
            manifest: {},
            pkg: { name: "pkg-a", version: "1.0.0" },
          },
          "pkg-b": {
            name: "pkg-b",
            version: "1.0.0",
            dir: "/test/b",
            manifest: {},
            pkg: { name: "pkg-b", version: "1.0.0" },
          },
        },
        byDir: {},
      };

      const reverseMap = buildReverseDependencyMap(graph, index);

      expect(reverseMap.get("pkg-a")).toEqual([]);
      expect(reverseMap.get("pkg-b")).toEqual([]);
    });
  });

  describe("getDirectConsumers", () => {
    it("should return direct consumers for a provider", () => {
      const reverseMap = new Map<string, string[]>();
      reverseMap.set("provider", ["consumer-a", "consumer-b"]);
      reverseMap.set("other", ["consumer-c"]);

      const consumers = getDirectConsumers("provider", reverseMap);

      expect(consumers).toEqual(["consumer-a", "consumer-b"]);
    });

    it("should return empty array if provider has no consumers", () => {
      const reverseMap = new Map<string, string[]>();
      reverseMap.set("provider", []);

      const consumers = getDirectConsumers("provider", reverseMap);

      expect(consumers).toEqual([]);
    });

    it("should return empty array if provider not in map", () => {
      const reverseMap = new Map<string, string[]>();

      const consumers = getDirectConsumers("unknown", reverseMap);

      expect(consumers).toEqual([]);
    });
  });

  describe("matchesGlobPatterns", () => {
    it("should match exact package names", () => {
      expect(matchesGlobPatterns("@kb-labs/core", ["@kb-labs/core"])).toBe(true);
      expect(matchesGlobPatterns("other-pkg", ["@kb-labs/core"])).toBe(false);
    });

    it("should match wildcard patterns", () => {
      expect(matchesGlobPatterns("@kb-labs/core", ["@kb-labs/*"])).toBe(true);
      expect(matchesGlobPatterns("@kb-labs/cli", ["@kb-labs/*"])).toBe(true);
      expect(matchesGlobPatterns("@other/pkg", ["@kb-labs/*"])).toBe(false);
    });

    it("should match multiple patterns", () => {
      const patterns = ["@kb-labs/*", "@other/*"];
      expect(matchesGlobPatterns("@kb-labs/core", patterns)).toBe(true);
      expect(matchesGlobPatterns("@other/pkg", patterns)).toBe(true);
      expect(matchesGlobPatterns("@unrelated/pkg", patterns)).toBe(false);
    });

    it("should match all when no patterns provided", () => {
      expect(matchesGlobPatterns("any-package", undefined)).toBe(true);
      expect(matchesGlobPatterns("any-package", [])).toBe(true);
    });

    it("should handle complex wildcards", () => {
      expect(matchesGlobPatterns("my-package-core", ["my-*-core"])).toBe(true);
      expect(matchesGlobPatterns("my-package-utils", ["my-*-core"])).toBe(false);
    });
  });

  describe("filterProviders", () => {
    it("should filter providers by patterns", () => {
      const packages = ["@kb-labs/core", "@kb-labs/cli", "@other/pkg"];
      const filtered = filterProviders(packages, ["@kb-labs/*"]);

      expect(filtered).toEqual(["@kb-labs/core", "@kb-labs/cli"]);
    });

    it("should return all providers when no patterns", () => {
      const packages = ["pkg-a", "pkg-b", "pkg-c"];
      const filtered = filterProviders(packages, undefined);

      expect(filtered).toEqual(packages);
    });
  });

  describe("filterConsumers", () => {
    it("should filter consumers by patterns", () => {
      const consumers = ["consumer-a", "consumer-b", "other-consumer"];
      const filtered = filterConsumers(consumers, ["consumer-*"]);

      expect(filtered).toEqual(["consumer-a", "consumer-b"]);
    });

    it("should return all consumers when no patterns", () => {
      const consumers = ["consumer-a", "consumer-b"];
      const filtered = filterConsumers(consumers, undefined);

      expect(filtered).toEqual(consumers);
    });
  });
});

