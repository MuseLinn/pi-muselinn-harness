// ============================================================
// Goal Types — Kimi Code-style lifecycle + Budget Report
// ============================================================

export type GoalStatus = 'active' | 'paused' | 'blocked' | 'complete' | 'usage_limited' | 'budget_limited';
export type GoalActor = 'user' | 'model' | 'runtime' | 'system';

export interface GoalBudgetLimits {
  tokenBudget?: number;
  turnBudget?: number;
  wallClockBudgetMs?: number;
}

/**
 * Friendly helper: convert a budget value + unit into GoalBudgetLimits.
 * Supports turns/tokens for count budgets and ms/s/minutes/hours for wall clock.
 */
export function parseBudgetToLimits(budget: number, unit: string): GoalBudgetLimits {
  switch (unit) {
    case "turns":
      return { turnBudget: budget };
    case "tokens":
      return { tokenBudget: budget };
    case "ms":
      return { wallClockBudgetMs: budget };
    case "s":
      return { wallClockBudgetMs: budget * 1000 };
    case "minutes":
      return { wallClockBudgetMs: budget * 60 * 1000 };
    case "hours":
      return { wallClockBudgetMs: budget * 60 * 60 * 1000 };
    default:
      return {};
  }
}

export interface GoalBudgetReport {
  tokenBudget: number | null;
  turnBudget: number | null;
  wallClockBudgetMs: number | null;
  remainingTokens: number | null;
  remainingTurns: number | null;
  remainingWallClockMs: number | null;
  tokenBudgetReached: boolean;
  turnBudgetReached: boolean;
  wallClockBudgetReached: boolean;
  overBudget: boolean;
}

export interface GoalSnapshot {
  goalId: string;
  objective: string;
  completionCriterion?: string;
  status: GoalStatus;
  lastActor: GoalActor;
  lastActedAt: string; // ISO timestamp for audit
  turnsUsed: number;
  tokensUsed: number;
  wallClockMs: number;
  wallClockResumedAt?: number; // timestamp when goal became active
  budgetLimits?: GoalBudgetLimits;
  budget?: GoalBudgetReport;
  terminalReason?: string;
  completionSummary?: string;    // Kimi Code: preserved after goal completion
  /** Queue position if goal is part of a queue */
  queueIndex?: number;
}

// Goal Queue types
export interface GoalQueueItem {
  id: string;
  objective: string;
  completionCriterion?: string;
  budgetLimits?: GoalBudgetLimits;
  status: "pending" | "active" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
  /**
   * P0 (4): priority recorded at enqueue time so a real priority queue can be
   * maintained by insertion. Optional for backward compatibility with any items
   * created before this field existed (defaults to "normal").
   */
  priority?: "high" | "normal" | "low";
}

export interface GoalQueue {
  items: GoalQueueItem[];
  currentIndex: number;
  mode: "fifo" | "priority";
}

// Entry type for persistence
export const GOAL_ENTRY_TYPE = "muselinn_goal";

export interface GoalEntryData {
  goalId: string;
  objective: string;
  completionCriterion?: string;
  status: GoalStatus;
  lastActor: GoalActor;
  lastActedAt: string;
  turnsUsed: number;
  tokensUsed: number;
  wallClockMs: number;
  wallClockResumedAt?: number;
  budgetLimits?: GoalBudgetLimits;
  terminalReason?: string;
}

// Global state
export let currentGoal: GoalSnapshot | null = null;
export function setCurrentGoal(g: GoalSnapshot | null): void { currentGoal = g; }

export let currentQueue: GoalQueue = { items: [], currentIndex: 0, mode: "fifo" };
export function setCurrentQueue(q: GoalQueue): void { currentQueue = q; }
