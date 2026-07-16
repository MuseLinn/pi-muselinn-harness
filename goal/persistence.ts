// ============================================================
// Goal Persistence — appendEntry + session_start recovery
// ============================================================

import type { GoalSnapshot, GoalEntryData } from "./types";
import { GOAL_ENTRY_TYPE, setCurrentGoal } from "./types";

/**
 * Serialize goal to entry data for appendEntry persistence.
 */
export function goalToEntryData(goal: GoalSnapshot | null): GoalEntryData | null {
  if (!goal) return null;
  return {
    goalId: goal.goalId,
    objective: goal.objective,
    completionCriterion: goal.completionCriterion,
    status: goal.status,
    lastActor: goal.lastActor,
    lastActedAt: goal.lastActedAt,
    turnsUsed: goal.turnsUsed,
    tokensUsed: goal.tokensUsed,
    wallClockMs: goal.wallClockMs,
    wallClockResumedAt: goal.wallClockResumedAt,
    budgetLimits: goal.budgetLimits,
    terminalReason: goal.terminalReason,
  };
}

/**
 * Restore goal from entry data.
 */
export function goalFromEntryData(data: GoalEntryData): GoalSnapshot {
  return {
    goalId: data.goalId,
    objective: data.objective,
    completionCriterion: data.completionCriterion,
    status: data.status,
    lastActor: data.lastActor,
    lastActedAt: data.lastActedAt,
    turnsUsed: data.turnsUsed,
    tokensUsed: data.tokensUsed,
    wallClockMs: data.wallClockMs,
    wallClockResumedAt: data.wallClockResumedAt,
    budgetLimits: data.budgetLimits,
    terminalReason: data.terminalReason,
  };
}

/**
 * Check if an entry is a goal entry.
 */
export function isGoalEntry(entry: any): boolean {
  return entry?.type === GOAL_ENTRY_TYPE;
}

/**
 * Reconstruct goal from session entries (Kimi Code-style normalization).
 * Called during session_start to restore goal state.
 * 
 * Normalization rules (from Kimi Code):
 * - active → paused (goal can't still be running after restart)
 * - paused → preserved
 * - blocked → preserved
 * - complete → cleared (should have been cleared already)
 */
export function reconstructGoalFromEntries(entries: any[]): GoalSnapshot | null {
  // Find the most recent goal entry
  const goalEntries = entries.filter(isGoalEntry);
  if (goalEntries.length === 0) return null;

  // Get the latest goal entry
  const latestEntry = goalEntries[goalEntries.length - 1];
  const data = latestEntry.data as GoalEntryData;
  if (!data) return null;

  const goal = goalFromEntryData(data);

  // Normalize status after replay (Kimi Code-style)
  if (goal.status === 'complete') {
    // Complete goals should have been cleared - discard
    return null;
  }

  if (goal.status === 'active') {
    // Active goal can't still be running after restart - pause it
    goal.status = 'paused';
    goal.terminalReason = 'Paused after agent resume';
    goal.wallClockResumedAt = undefined;
  }

  // paused and blocked are preserved (both resumable)
  return goal;
}

/**
 * Create persistence callback for pi.appendEntry.
 */
export function createGoalPersistenceCallback(appendEntry: (type: string, data: any) => void) {
  return (goal: GoalSnapshot | null): void => {
    const data = goalToEntryData(goal);
    if (data) {
      appendEntry(GOAL_ENTRY_TYPE, data);
    }
  };
}
