import { runCommand } from "../../utils";
import type { ApplyOptions, ApplyResult, DevLinkPlan, LinkAction } from "../types";
import { logger } from "../../utils/logger";
import { saveState } from "../../state";
import type { DevlinkState } from "../../types";
import { writeLastApply } from "../journal/last-apply";
import { discover } from "../../discovery";
import { promises as fsp } from "fs";
import { join } from "path";

// ───────────────────────────────────────────────────────────────────────────────
// DRY-RUN TABLE
// ───────────────────────────────────────────────────────────────────────────────
function printDryRunTable(plan: DevLinkPlan): void {
  console.log("\n=== DevLink Plan (DRY RUN) ===\n");
  console.log(`Mode: ${plan.mode}`);
  console.log(`Root: ${plan.rootDir}\n`);

  if ((plan.diagnostics?.length ?? 0) > 0) {
    console.log("⚠️  Diagnostics:");
    plan.diagnostics.forEach(d => console.log(`   ${d}`));
    console.log();
  }

  if ((plan.actions?.length ?? 0) === 0) {
    console.log("No actions to perform.\n");
    return;
  }

  console.log("Actions:");
  console.log("─".repeat(100));
  console.log(
    "TARGET".padEnd(35) +
    "DEPENDENCY".padEnd(35) +
    "KIND".padEnd(15) +
    "REASON"
  );
  console.log("─".repeat(100));

  for (const action of plan.actions) {
    const target = action.target.length > 33 ? "..." + action.target.slice(-30) : action.target;
    const dep = action.dep.length > 33 ? "..." + action.dep.slice(-30) : action.dep;
    console.log(
      target.padEnd(35) +
      dep.padEnd(35) +
      action.kind.padEnd(15) +
      (action.reason || "")
    );
  }

  console.log("─".repeat(100));
  console.log(`\nTotal: ${plan.actions.length} actions\n`);
}

// ───────────────────────────────────────────────────────────────────────────────
// BATCH & PROGRESS HELPERS
// ───────────────────────────────────────────────────────────────────────────────

type DepKind = "prod" | "dev" | "peer";
type TargetBatch = {
  yalcRemove: Set<string>;
  yalcAdd: Set<string>;
  npmProd: Set<string>;
  npmDev: Set<string>;
  npmPeer: Set<string>;
  wsProd: Set<string>;
  wsDev: Set<string>;
  wsPeer: Set<string>;
};

function resolveDepKind(plan: DevLinkPlan, consumer: string, provider: string): DepKind {
  const edge = plan.graph?.edges?.find(e => e.from === consumer && e.to === provider);
  if (!edge) { return "prod"; }
  if (edge.type === "dev") { return "dev"; }
  if (edge.type === "peer") { return "peer"; }
  return "prod"; // "dep" → prod
}

function ensureBatch(map: Map<string, TargetBatch>, key: string): TargetBatch {
  let b = map.get(key);
  if (!b) {
    b = {
      yalcRemove: new Set(),
      yalcAdd: new Set(),
      npmProd: new Set(),
      npmDev: new Set(),
      npmPeer: new Set(),
      wsProd: new Set(),
      wsDev: new Set(),
      wsPeer: new Set(),
    };
    map.set(key, b);
  }
  return b;
}

function resolveTargetCwd(plan: DevLinkPlan, target: string): string {
  return plan.index?.packages?.[target]?.dir ?? target;
}

function fmtList(items: Set<string>): string {
  const arr = Array.from(items);
  if (arr.length === 0) { return "—"; }
  if (arr.length <= 3) { return arr.join(", "); }
  return `${arr.slice(0, 3).join(", ")} (+${arr.length - 3})`;
}

// ───────────────────────────────────────────────────────────────────────────────
// package.json helpers for prefiltering install batches
// ───────────────────────────────────────────────────────────────────────────────

async function loadPkgJson(dir: string): Promise<any | null> {
  try {
    const raw = await fsp.readFile(join(dir, "package.json"), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getSpec(pkg: any, section: "dependencies" | "devDependencies" | "peerDependencies", name: string): string | undefined {
  return pkg?.[section]?.[name];
}

function isWorkspaceSpec(spec?: string): boolean {
  return typeof spec === "string" && spec.startsWith("workspace:");
}

function prefilterBatchDeps(batch: TargetBatch, pkg: any) {
  if (!pkg) { return; }

  // Helper to remove items that don't need install
  const removeIf = (set: Set<string>, shouldRemove: (name: string) => boolean) => {
    for (const name of Array.from(set)) {
      if (shouldRemove(name)) { set.delete(name); }
    }
  };

  // NPM deps: if already present in the same section with a non-workspace spec, pnpm add is usually a no-op.
  // Keep items if: missing OR currently workspace:* (we need to switch to npm).
  removeIf(batch.npmProd, (name) => {
    const spec = getSpec(pkg, "dependencies", name);
    return !!spec && !isWorkspaceSpec(spec);
  });
  removeIf(batch.npmDev, (name) => {
    const spec = getSpec(pkg, "devDependencies", name);
    return !!spec && !isWorkspaceSpec(spec);
  });
  removeIf(batch.npmPeer, (name) => {
    const spec = getSpec(pkg, "peerDependencies", name);
    return !!spec && !isWorkspaceSpec(spec);
  });

  // Workspace deps (tokens like "foo@workspace:*"): skip if already workspace in the appropriate section
  const stripWs = (token: string) => token.replace(/@workspace:.*$/, "");
  removeIf(batch.wsProd, (token) => {
    const name = stripWs(token);
    const spec = getSpec(pkg, "dependencies", name);
    return isWorkspaceSpec(spec);
  });
  removeIf(batch.wsDev, (token) => {
    const name = stripWs(token);
    const spec = getSpec(pkg, "devDependencies", name);
    return isWorkspaceSpec(spec);
  });
  removeIf(batch.wsPeer, (token) => {
    const name = stripWs(token);
    const spec = getSpec(pkg, "peerDependencies", name);
    return isWorkspaceSpec(spec);
  });
}

// ───────────────────────────────────────────────────────────────────────────────
// PNPM helpers (+ live progress)
// ───────────────────────────────────────────────────────────────────────────────

function getPnpmFlags(): string {
  const base = ["--lockfile=false", "--reporter=silent", "--prefer-offline"];
  if (process.env.KB_DEVLINK_IGNORE_SCRIPTS === "1") { base.push("--ignore-scripts"); }
  if (process.env.KB_DEVLINK_NO_OPTIONAL === "1") { base.push("--no-optional"); }
  return base.join(" ");
}

function pnpmAddCmd(target: string, deps: string[], dev = false, peer = false) {
  const role = dev ? "-D" : peer ? "-P" : "";
  return `pnpm add ${role} ${deps.join(" ")} --filter ${target} ${getPnpmFlags()}`.trim();
}

/** Render single-line progress pinned to bottom (rewritable). */
function renderProgress(line: string) {
  if (!process.stdout.isTTY) {
    // Fallback in non-interactive environments
    console.log(line);
    return;
  }
  // erase line + carriage return + write
  process.stdout.write(`\x1b[2K\r${line}`);
}

/** Clear pinned progress line (prints newline at the end). */
function clearProgress() {
  if (!process.stdout.isTTY) { return; }
  process.stdout.write("\x1b[2K\r\n");
}

// ───────────────────────────────────────────────────────────────────────────────
// APPLY
// ───────────────────────────────────────────────────────────────────────────────

export async function applyPlan(plan: DevLinkPlan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  logger.info(`devlink: apply (mode=${plan.mode}, dryRun=${!!opts.dryRun})`);

  // DRY-RUN: печатаем таблицу и выходим РАНО (никаких побочных эффектов и summary)
  if (opts.dryRun) {
    printDryRunTable(plan);
    return {
      ok: true,
      executed: [],
      skipped: [],
      errors: [],
    };
  }

  const executed: LinkAction[] = [];
  const skipped: LinkAction[] = [];
  const errors: { action: LinkAction; error: unknown }[] = [];

  if (!plan.actions || !plan.index) {
    // Нечего делать — "тихо" выходим, без таблиц и без summary (мы не в dry-run)
    logger.info("Apply completed", { ok: true, executed: 0, skipped: 0, errors: 0, time: 0 });
    return { ok: true, executed, skipped, errors };
  }

  // 1) Build batches by target
  const byTarget = new Map<string, TargetBatch>();
  for (const a of plan.actions) {
    if (!a?.target || !a?.dep) { continue; }
    const b = ensureBatch(byTarget, a.target);

    switch (a.kind) {
      case "unlink": {
        b.yalcRemove.add(a.dep);
        break;
      }
      case "link-local": {
        b.yalcAdd.add(a.dep);
        break;
      }
      case "use-workspace": {
        const kind = resolveDepKind(plan, a.target, a.dep);
        const token = `${a.dep}@workspace:*`;
        if (kind === "dev") { b.wsDev.add(token); }
        else if (kind === "peer") { b.wsPeer.add(token); }
        else { b.wsProd.add(token); }
        break;
      }
      case "use-npm": {
        const kind = resolveDepKind(plan, a.target, a.dep);
        b.yalcRemove.add(a.dep); // safety: снять yalc перед npm
        if (kind === "dev") { b.npmDev.add(a.dep); }
        else if (kind === "peer") { b.npmPeer.add(a.dep); }
        else { b.npmProd.add(a.dep); }
        break;
      }
    }
  }

  // 2) Execute batches with progress
  const targets = Array.from(byTarget.keys());
  const total = targets.length;
  const t0 = Date.now();

  console.log("\n🔧 Applying batched operations…\n");

  let idx = 0;
  for (const target of targets) {
    const batch = byTarget.get(target)!;
    const cwd = resolveTargetCwd(plan, target);

    // Prefilter already-satisfied deps to avoid no-op pnpm calls
    const pkgJson = await loadPkgJson(cwd);
    prefilterBatchDeps(batch, pkgJson);

    // PNPM фильтруем из корня монорепы
    const cwdPnpm = plan.rootDir;
    const cwdYalc = cwd;

    const step = `[#${++idx}/${total}] ${target}`;
    const summary =
      `yalc rm:${batch.yalcRemove.size} add:${batch.yalcAdd.size} | ` +
      `ws p:${batch.wsProd.size} d:${batch.wsDev.size} pr:${batch.wsPeer.size} | ` +
      `npm p:${batch.npmProd.size} d:${batch.npmDev.size} pr:${batch.npmPeer.size}`;

    renderProgress(`${step}  ${summary}`);

    const markExecuted = () => {
      for (const a of plan.actions.filter(x => x.target === target)) { executed.push(a); }
    };

    const markError = (err: unknown) => {
      const representative: LinkAction = {
        target,
        dep: "<batch>",
        kind: "use-npm",
        reason: "batched install failed",
      };
      errors.push({ action: representative, error: err });
    };

    try {
      const runYalc = (cmd: string, allowFail = false) => runCommand(cmd, { cwd: cwdYalc, allowFail });
      const runPnpm = (cmd: string, allowFail = false) => runCommand(cmd, { cwd: cwdPnpm, allowFail });

      // yalc remove (batch)
      if (batch.yalcRemove.size > 0) {
        await runYalc(`yalc remove ${Array.from(batch.yalcRemove).join(" ")} || true`, true);
      }
      // yalc add (batch)
      if (batch.yalcAdd.size > 0) {
        await runYalc(`yalc add ${Array.from(batch.yalcAdd).join(" ")} --link`);
      }

      // workspace deps
      if (batch.wsProd.size > 0) {
        await runPnpm(pnpmAddCmd(target, Array.from(batch.wsProd)));
      }
      if (batch.wsDev.size > 0) {
        await runPnpm(pnpmAddCmd(target, Array.from(batch.wsDev), true /*dev*/));
      }
      if (batch.wsPeer.size > 0) {
        await runPnpm(pnpmAddCmd(target, Array.from(batch.wsPeer), false, true /*peer*/));
      }

      // npm deps
      if (batch.npmProd.size > 0) {
        await runPnpm(pnpmAddCmd(target, Array.from(batch.npmProd)));
      }
      if (batch.npmDev.size > 0) {
        await runPnpm(pnpmAddCmd(target, Array.from(batch.npmDev), true /*dev*/));
      }
      if (batch.npmPeer.size > 0) {
        await runPnpm(pnpmAddCmd(target, Array.from(batch.npmPeer), false, true /*peer*/));
      }

      markExecuted();
      renderProgress(`${step}  ✓ done`);
      clearProgress();
    } catch (error) {
      markError(error);
      logger.warn(`batch failed for ${target}`, error as any);
      renderProgress(`${step}  ✗ failed`);
      clearProgress();
      console.log(`     reason: ${(error as Error)?.message || String(error)}`);
    }
  }

  clearProgress();

  // 3) Save state & journal
  const state = await discover({ roots: [plan.rootDir] });
  const nextState: DevlinkState = {
    ...state,
    devlinkVersion: "0.1.0",
    generatedAt: new Date().toISOString(),
  };
  await saveState(nextState, plan.rootDir);
  await writeLastApply(plan, executed);
  logger.info("State and journal saved");

  const dt = Date.now() - t0;
  logger.info("Apply completed", { ok: errors.length === 0, executed: executed.length, skipped: skipped.length, errors: errors.length, time: dt });

  // 4) Friendly summary — только при реальном применении
  console.log("🔍 DevLink Apply\n");
  console.log("=====================\n");

  if (targets.length) {
    console.log(`Affected targets: ${targets.length}`);
    console.log(`Examples:`);
    const sample = targets.slice(0, 5).map(t => `  • ${t}`).join("\n");
    console.log(sample + (targets.length > 5 ? `\n  …and ${targets.length - 5} more` : ""));
    console.log();
  } else if (!opts.preflightCancelled) {
    // Only show "Nothing to apply" if preflight didn't cancel the operation
    console.log("Nothing to apply.\n");
  }

  if (plan.diagnostics?.length) {
    console.log("Diagnostics:\n");
    for (const d of plan.diagnostics) { console.log(`  ℹ ${d}`); }
    console.log();
  }

  console.log("Summary:");
  console.log(`  ✓ Executed: ${executed.length}`);
  console.log(`  ⊘ Skipped:  ${skipped.length}`);
  console.log(`  ✗ Errors:   ${errors.length}\n`);
  console.log(`⏱️  Duration: ${dt}ms\n`);

  return {
    ok: errors.length === 0,
    executed,
    skipped,
    errors,
  };
}