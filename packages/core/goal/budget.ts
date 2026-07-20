// ============================================================
// Goal Budget — Report computation + Prompt injection
// ============================================================

import type { GoalSnapshot, GoalBudgetReport, GoalBudgetLimits } from "./types.ts";

/**
 * Live active-pursuit time: the accumulated total plus the in-flight active interval.
 * Correct even when read mid-turn (the interval isn't folded into wallClockMs until the goal leaves active).
 */
export function liveWallClockMs(state: GoalSnapshot, now: number = Date.now()): number {
  if (state.status === 'active' && state.wallClockResumedAt !== undefined) {
    return state.wallClockMs + Math.max(0, now - state.wallClockResumedAt);
  }
  return state.wallClockMs;
}

/**
 * Compute budget report for a goal (Kimi Code-style).
 * Returns remaining amounts and whether each budget is reached.
 */
export function computeBudgetReport(state: GoalSnapshot, now: number = Date.now()): GoalBudgetReport {
  const limits = state.budgetLimits ?? {};
  const tokenBudget = limits.tokenBudget ?? null;
  const turnBudget = limits.turnBudget ?? null;
  const wallClockBudgetMs = limits.wallClockBudgetMs ?? null;
  const wallClockMs = liveWallClockMs(state, now);

  const tokenBudgetReached = tokenBudget !== null && state.tokensUsed >= tokenBudget;
  const turnBudgetReached = turnBudget !== null && state.turnsUsed >= turnBudget;
  const wallClockBudgetReached = wallClockBudgetMs !== null && wallClockMs >= wallClockBudgetMs;

  return {
    tokenBudget,
    turnBudget,
    wallClockBudgetMs,
    remainingTokens: tokenBudget === null ? null : Math.max(0, tokenBudget - state.tokensUsed),
    remainingTurns: turnBudget === null ? null : Math.max(0, turnBudget - state.turnsUsed),
    remainingWallClockMs: wallClockBudgetMs === null ? null : Math.max(0, wallClockBudgetMs - wallClockMs),
    tokenBudgetReached,
    turnBudgetReached,
    wallClockBudgetReached,
    overBudget: tokenBudgetReached || turnBudgetReached || wallClockBudgetReached,
  };
}

/**
 * Format budget report as a human-readable string for prompt injection.
 */
export function formatBudgetReport(report: GoalBudgetReport): string {
  const parts: string[] = [];

  if (report.tokenBudget !== null) {
    const used = report.tokenBudget - (report.remainingTokens ?? 0);
    const pct = report.tokenBudget > 0 ? Math.round((used / report.tokenBudget) * 100) : 0;
    parts.push(`↑${used}/${report.tokenBudget} (${pct}% used, ${report.remainingTokens} remaining)`);
  }

  if (report.turnBudget !== null) {
    const used = report.turnBudget - (report.remainingTurns ?? 0);
    parts.push(`Turns: ${used}/${report.turnBudget} (${report.remainingTurns} remaining)`);
  }

  if (report.wallClockBudgetMs !== null) {
    const usedMs = report.wallClockBudgetMs - (report.remainingWallClockMs ?? 0);
    const usedMin = Math.round(usedMs / 60000);
    const totalMin = Math.round(report.wallClockBudgetMs / 60000);
    const remainMin = Math.round((report.remainingWallClockMs ?? 0) / 60000);
    parts.push(`Time: ${usedMin}min/${totalMin}min (${remainMin}min remaining)`);
  }

  if (parts.length === 0) return "";
  return `Budget: ${parts.join(" | ")}`;
}

/**
 * Budget guidance string for prompt injection (Kimi Code-style).
 * Returns undefined if no budget limits are set.
 */
export function budgetBandGuidance(goal: GoalSnapshot): string | undefined {
  if (!goal || goal.status === "complete") return undefined;
  const report = computeBudgetReport(goal);
  const formatted = formatBudgetReport(report);
  return formatted || undefined;
}
