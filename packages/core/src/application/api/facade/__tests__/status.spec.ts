import { describe, it, expect } from "vitest";
import { status } from "../status";
import path from "node:path";

describe("status", () => {
  it("should return status report without crashing", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const result = await status({ rootDir });
    
    expect(result).toBeDefined();
    expect(result.ok).toBe(true);
    expect(result.context).toBeDefined();
    expect(result.lock).toBeDefined();
    expect(result.diff).toBeDefined();
    expect(result.warnings).toBeDefined();
    expect(result.suggestions).toBeDefined();
    expect(result.timings).toBeDefined();
  });

  it("should have valid context", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const result = await status({ rootDir });
    
    expect(result.context.rootDir).toBe(rootDir);
    expect(result.context.mode).toMatch(/^(local|yalc|workspace|auto|remote|unknown)$/);
    expect(result.context.modeSource).toMatch(/^(plan|lock|inferred|unknown)$/);
    expect(result.context.lastOperation).toMatch(/^(apply|freeze|none)$/);
    expect(result.context.undo).toBeDefined();
    expect(typeof result.context.undo.available).toBe("boolean");
  });

  it("should have valid lock stats", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const result = await status({ rootDir });
    
    expect(typeof result.lock.exists).toBe("boolean");
    expect(typeof result.lock.consumers).toBe("number");
    expect(typeof result.lock.deps).toBe("number");
    expect(result.lock.sources).toBeDefined();
    expect(typeof result.lock.sources).toBe("object");
  });

  it("should have valid diff structure", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const result = await status({ rootDir });
    
    expect(result.diff.summary).toBeDefined();
    expect(typeof result.diff.summary.added).toBe("number");
    expect(typeof result.diff.summary.updated).toBe("number");
    expect(typeof result.diff.summary.removed).toBe("number");
    expect(typeof result.diff.summary.mismatched).toBe("number");
    expect(result.diff.byConsumer).toBeDefined();
    expect(result.diff.samples).toBeDefined();
  });

  it("should have valid warnings", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const result = await status({ rootDir });
    
    expect(Array.isArray(result.warnings)).toBe(true);
    
    for (const warning of result.warnings) {
      expect(warning.code).toBeDefined();
      expect(warning.severity).toMatch(/^(info|warn|error)$/);
      expect(warning.message).toBeDefined();
    }
  });

  it("should have valid suggestions", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const result = await status({ rootDir });
    
    expect(Array.isArray(result.suggestions)).toBe(true);
    
    for (const suggestion of result.suggestions) {
      expect(suggestion.id).toBeDefined();
      expect(suggestion.command).toBeDefined();
      expect(Array.isArray(suggestion.args)).toBe(true);
      expect(suggestion.description).toBeDefined();
      expect(suggestion.impact).toMatch(/^(safe|disruptive)$/);
    }
  });

  it("should have performance timings", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const result = await status({ rootDir });
    
    expect(result.timings.readFs).toBeGreaterThanOrEqual(0);
    expect(result.timings.readLock).toBeGreaterThanOrEqual(0);
    expect(result.timings.diff).toBeGreaterThanOrEqual(0);
    expect(result.timings.warnings).toBeGreaterThanOrEqual(0);
    expect(result.timings.total).toBeGreaterThanOrEqual(0);
    expect(result.timings.total).toBeLessThan(1000); // Should be < 1s
  });

  it("should filter warnings by level", async () => {
    const rootDir = path.resolve(__dirname, "../../../../..");
    
    const allResult = await status({ rootDir, warningLevel: "all" });
    const warnResult = await status({ rootDir, warningLevel: "warn" });
    const errorResult = await status({ rootDir, warningLevel: "error" });
    const noneResult = await status({ rootDir, warningLevel: "none" });
    
    expect(warnResult.warnings.length).toBeLessThanOrEqual(allResult.warnings.length);
    expect(errorResult.warnings.length).toBeLessThanOrEqual(warnResult.warnings.length);
    expect(noneResult.warnings.length).toBe(0);
  });
});

