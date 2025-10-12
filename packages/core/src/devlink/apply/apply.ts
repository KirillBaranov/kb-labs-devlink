import { runCommand } from "../../utils";
import type { ApplyOptions, ApplyResult, DevLinkPlan, LinkAction } from "../types";
import { logger } from "../../utils/logger";
import { saveState } from "../../state";
import type { DevlinkState } from "../../types";
import { writeLastApply } from "../journal/last-apply";
import { discover } from "../../discovery";

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

async function execAction(action: LinkAction, opts: ApplyOptions, plan: DevLinkPlan): Promise<void> {
  const { target, dep, kind } = action;

  if (opts.dryRun) {
    return;
  }

  const cwd = plan.index?.packages?.[target]?.dir ?? target;

  switch (kind) {
    case "link-local":
      await runCommand(`yalc add ${dep} --link`, { cwd });
      break;
    case "use-workspace":
      await runCommand(`pnpm i ${dep}@workspace:*`, { cwd });
      break;
    case "use-npm":
      // сначала убираем возможный yalc-линк, затем ставим с npm
      await runCommand(`yalc remove ${dep} || true`, { cwd, allowFail: true });
      await runCommand(`pnpm i ${dep}`, { cwd });
      break;
    case "unlink":
      await runCommand(`yalc remove ${dep}`, { cwd, allowFail: true });
      break;
  }
}

export async function applyPlan(plan: DevLinkPlan, opts: ApplyOptions = {}): Promise<ApplyResult> {
  logger.info(`devlink: apply (mode=${plan.mode}, dryRun=${!!opts.dryRun})`);

  if (opts.dryRun && plan.actions && plan.diagnostics) {
    printDryRunTable(plan);
  }

  const executed: LinkAction[] = [];
  const skipped: LinkAction[] = [];
  const errors: { action: LinkAction; error: unknown }[] = [];

  if (!plan.actions || !plan.index) {
    return {
      ok: true,
      executed,
      skipped,
      errors,
    };
  }

  for (const action of plan.actions) {
    if (!action || !action.target || !action.dep) {
      continue;
    }
    try {
      await execAction(action, opts, plan);
      executed.push(action);
    } catch (error) {
      errors.push({ action, error });
      logger.warn(`action failed: ${action.kind} ${action.dep} -> ${action.target}`, error as any);
    }
  }

  // Save state and journal if not dry-run
  if (!opts.dryRun) {
    // Refresh state from discovery
    const state = await discover({ roots: [plan.rootDir] });

    // Add execution metadata
    const nextState: DevlinkState = {
      ...state,
      devlinkVersion: "0.1.0",
      generatedAt: new Date().toISOString(),
    };

    await saveState(nextState, plan.rootDir);

    // Write journal for undo
    await writeLastApply(plan, executed);

    logger.info("State and journal saved");
  }

  return {
    ok: errors.length === 0,
    executed,
    skipped,
    errors,
  };
}