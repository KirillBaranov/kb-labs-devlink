import { readJson, writeJson, exists } from "../../utils/fs";
import { logger } from "../../utils/logger";
import type { DevLinkPlan, LinkAction } from "../types";

export interface LastApplyJournal {
  rootDir: string;
  ts: string; // ISO timestamp
  mode: string;
  actions: LinkAction[];
}

/**
 * Write last-apply journal for undo functionality
 */
export async function writeLastApply(
  plan: DevLinkPlan,
  executed: LinkAction[]
): Promise<void> {
  const journal: LastApplyJournal = {
    rootDir: plan.rootDir,
    ts: new Date().toISOString(),
    mode: plan.mode,
    actions: executed,
  };

  const journalPath = `${plan.rootDir}/.kb/devlink/last-apply.json`;
  await writeJson(journalPath, journal);

  logger.debug("Last-apply journal written", {
    path: journalPath,
    actions: executed.length
  });
}

/**
 * Read last-apply journal
 */
export async function readLastApply(
  rootDir: string
): Promise<LastApplyJournal | null> {
  const journalPath = `${rootDir}/.kb/devlink/last-apply.json`;

  if (!(await exists(journalPath))) {
    return null;
  }

  try {
    const journal = await readJson<LastApplyJournal>(journalPath);
    return journal;
  } catch (error) {
    logger.warn("Failed to read last-apply journal", error);
    return null;
  }
}

