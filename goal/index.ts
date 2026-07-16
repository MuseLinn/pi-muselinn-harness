// ============================================================
// Goal System — Kimi Code-style lifecycle + persistence + injection
// ============================================================

import type { GoalSnapshot, GoalStatus, GoalActor, GoalBudgetLimits } from "./types";
import { currentGoal, setCurrentGoal, GOAL_ENTRY_TYPE } from "./types";
import { computeBudgetReport, budgetBandGuidance, liveWallClockMs } from "./budget";
import { goalToEntryData, goalFromEntryData, reconstructGoalFromEntries } from "./persistence";
import { registerGoalTools } from "./tools";
import { registerGoalCommands } from "./commands";
import { autoSwitchToNext } from "./queue";

/** Mutate status on an existing goal snapshot (immutable style). */
function cloneSnapshot(s: GoalSnapshot, patch: Partial<GoalSnapshot>): GoalSnapshot {
  return { ...s, ...patch };
}

// ============================================================
// GoalManager — lifecycle + persistence + prompt injection
// ============================================================

export class GoalManager {
  private persistFn: ((data: GoalSnapshot | null) => void) | null = null;
  private appendEntryFn: ((type: string, data: any) => void) | null = null;

  /** Bind a persistence callback (called every time goal changes) */
  setPersistence(fn: (data: GoalSnapshot | null) => void): void {
    this.persistFn = fn;
  }

  /** Bind appendEntry for persistence */
  setAppendEntry(fn: (type: string, data: any) => void): void {
    this.appendEntryFn = fn;
  }

  /** Persist current goal or null (clear) */
  private persist(): void {
    if (this.persistFn) this.persistFn(currentGoal);
    // Also persist via appendEntry if available
    if (this.appendEntryFn && currentGoal) {
      const data = goalToEntryData(currentGoal);
      if (data) {
        this.appendEntryFn(GOAL_ENTRY_TYPE, data);
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Create a new active goal */
  createGoal(
    objective: string,
    completionCriterion?: string,
    budgetLimits?: GoalBudgetLimits,
    actor: GoalActor = "user",
  ): GoalSnapshot {
    const goal: GoalSnapshot = {
      goalId: `g-${Date.now().toString(36)}`,
      objective,
      completionCriterion,
      status: "active",
      lastActor: actor,
      lastActedAt: new Date().toISOString(),
      turnsUsed: 0,
      tokensUsed: 0,
      wallClockMs: 0,
      wallClockResumedAt: Date.now(),
      budgetLimits,
    };
    setCurrentGoal(goal);
    this.persist();
    return goal;
  }

  /** Get the current goal */
  getGoal(): GoalSnapshot | null {
    return currentGoal;
  }

  /** Apply actor+timestamp to any snapshot patch */
  private withActor(patch: Partial<GoalSnapshot>, actor: GoalActor): Partial<GoalSnapshot> {
    return { ...patch, lastActor: actor, lastActedAt: new Date().toISOString() };
  }

  /** Update goal textual fields (keeps status) */
  editGoal(objective: string, completionCriterion?: string, actor: GoalActor = "user"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g) return null;
    const updated = cloneSnapshot(g, this.withActor({ objective, completionCriterion, status: "active" }, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  /** Pause → paused (Kimi Code-style wall clock handling) */
  pause(actor: GoalActor = "user"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g || g.status === "complete") return null;

    // Fold live wall clock interval into total (Kimi Code-style)
    const now = Date.now();
    let wallClockMs = g.wallClockMs;
    if (g.status === "active" && g.wallClockResumedAt !== undefined) {
      wallClockMs += Math.max(0, now - g.wallClockResumedAt);
    }

    const updated = cloneSnapshot(g, this.withActor({
      status: "paused" as GoalStatus,
      wallClockMs,
      wallClockResumedAt: undefined,
    }, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  /** Resume paused/blocked → active (Kimi Code-style wall clock handling) */
  resume(actor: GoalActor = "user"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g || g.status === "complete") return null;

    const updated = cloneSnapshot(g, this.withActor({
      status: "active" as GoalStatus,
      wallClockResumedAt: Date.now(),
      terminalReason: undefined, // Clear stop reason on resume
    }, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  /** Block — with optional budget-limit check */
  block(reason?: string, actor: GoalActor = "system"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g || g.status === "complete") return null;

    // Fold live wall clock interval
    const now = Date.now();
    let wallClockMs = g.wallClockMs;
    if (g.status === "active" && g.wallClockResumedAt !== undefined) {
      wallClockMs += Math.max(0, now - g.wallClockResumedAt);
    }

    const updated = cloneSnapshot(g, this.withActor({
      status: "blocked" as GoalStatus,
      terminalReason: reason,
      wallClockMs,
      wallClockResumedAt: undefined,
    }, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  /** Mark complete */
  complete(actor: GoalActor = "user"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g) return null;

    // Fold live wall clock interval
    const now = Date.now();
    let wallClockMs = g.wallClockMs;
    if (g.status === "active" && g.wallClockResumedAt !== undefined) {
      wallClockMs += Math.max(0, now - g.wallClockResumedAt);
    }

    const updated = cloneSnapshot(g, this.withActor({
      status: "complete" as GoalStatus,
      wallClockMs,
      wallClockResumedAt: undefined,
    }, actor));
    setCurrentGoal(updated);
    this.persist();

    // Auto-switch to next goal in queue (@narumitw/pi-goal style)
    const nextItem = autoSwitchToNext();
    if (nextItem) {
      this.createGoal(
        nextItem.objective,
        nextItem.completionCriterion,
        nextItem.budgetLimits,
        "runtime"
      );
    }

    return updated;
  }

  /** Clear the goal */
  clear(actor: GoalActor = "user"): void {
    setCurrentGoal(null);
    this.persist();
  }

  /**
   * Pause on user interrupt (Kimi Code-style pauseOnInterrupt).
   * Called when user presses Esc, Ctrl+C, or any turn-level cancellation.
   */
  pauseOnInterrupt(reason?: string): GoalSnapshot | null {
    const g = currentGoal;
    if (!g || g.status !== "active") return null;
    return this.pause("user");
  }

  // ── Budget & Accounting ────────────────────────────────────────────────

  /**
   * Record a turn / token usage (Kimi Code-style).
   * Returns `{ crossedBudget }` if this turn pushed over the budget.
   * Auto-blocks the goal when budget is exceeded.
   */
  recordTurn(tokens: number, actor: GoalActor = "runtime"): { crossedBudget: boolean } {
    const g = currentGoal;
    if (!g || g.status !== "active") return { crossedBudget: false };

    const now = Date.now();
    const deltaMs = g.wallClockResumedAt ? Math.max(0, now - g.wallClockResumedAt) : 0;

    const newTokens = g.tokensUsed + tokens;
    const newTurns = g.turnsUsed + 1;
    const newWallClockMs = g.wallClockMs + deltaMs;

    // Check all three budget types
    const limits = g.budgetLimits ?? {};
    const crossedTokens = limits.tokenBudget !== undefined && limits.tokenBudget > 0 && newTokens >= limits.tokenBudget;
    const crossedTurns = limits.turnBudget !== undefined && limits.turnBudget > 0 && newTurns >= limits.turnBudget;
    const crossedWallClock = limits.wallClockBudgetMs !== undefined && limits.wallClockBudgetMs > 0 && newWallClockMs >= limits.wallClockBudgetMs;

    const crossed = crossedTokens || crossedTurns || crossedWallClock;
    let newStatus: GoalStatus = g.status;
    const terminalReason = crossed ? "Budget exceeded" : g.terminalReason;

    if (crossed) {
      // Distinguish budget_limited (tokenBudget) from blocked (other budgets)
      newStatus = crossedTokens ? "budget_limited" : "blocked";
    }

    setCurrentGoal(cloneSnapshot(g, this.withActor({
      turnsUsed: newTurns,
      tokensUsed: newTokens,
      wallClockMs: newWallClockMs,
      wallClockResumedAt: now, // Reset wall clock interval
      status: newStatus,
      terminalReason,
    }, actor)));
    this.persist();
    return { crossedBudget: crossed };
  }

  /**
   * Record token usage without incrementing turns (Kimi Code-style).
   */
  recordTokenUsage(delta: number): void {
    const g = currentGoal;
    if (!g || g.status !== "active") return;

    const newTokens = g.tokensUsed + Math.max(0, delta);
    setCurrentGoal(cloneSnapshot(g, {
      tokensUsed: newTokens,
    }));
    // Silent persist (no UI update)
    if (this.persistFn) this.persistFn(currentGoal);
  }

  /**
   * Increment turn count (Kimi Code-style).
   */
  incrementTurn(): void {
    const g = currentGoal;
    if (!g || g.status !== "active") return;

    const now = Date.now();
    const deltaMs = g.wallClockResumedAt ? Math.max(0, now - g.wallClockResumedAt) : 0;

    setCurrentGoal(cloneSnapshot(g, {
      turnsUsed: g.turnsUsed + 1,
      wallClockMs: g.wallClockMs + deltaMs,
      wallClockResumedAt: now,
    }));
    // Silent persist
    if (this.persistFn) this.persistFn(currentGoal);
  }

  /**
   * Set budget limits on the current goal (Kimi Code-style).
   */
  setBudgetLimits(limits: GoalBudgetLimits, actor: GoalActor = "user"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g) return null;

    const updated = cloneSnapshot(g, this.withActor({
      budgetLimits: { ...g.budgetLimits, ...limits },
    }, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  // ── Usage/Budget Limited Detection (@narumitw/pi-goal style) ──────────

  /**
   * Mark goal as usage_limited (provider quota exhausted, e.g., 429 error).
   */
  markUsageLimited(reason?: string, actor: GoalActor = "runtime"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g || g.status !== "active") return null;
    const now = Date.now();
    let wallClockMs = g.wallClockMs;
    if (g.wallClockResumedAt !== undefined) {
      wallClockMs += Math.max(0, now - g.wallClockResumedAt);
    }
    const updated = cloneSnapshot(g, this.withActor({
      status: "usage_limited" as GoalStatus,
      terminalReason: reason ?? "Provider quota exhausted",
      wallClockMs,
      wallClockResumedAt: undefined,
    }, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  /**
   * Mark goal as budget_limited (user token budget exceeded).
   */
  markBudgetLimited(reason?: string, actor: GoalActor = "runtime"): GoalSnapshot | null {
    const g = currentGoal;
    if (!g || g.status !== "active") return null;
    const now = Date.now();
    let wallClockMs = g.wallClockMs;
    if (g.wallClockResumedAt !== undefined) {
      wallClockMs += Math.max(0, now - g.wallClockResumedAt);
    }
    const updated = cloneSnapshot(g, this.withActor({
      status: "budget_limited" as GoalStatus,
      terminalReason: reason ?? "Token budget exceeded",
      wallClockMs,
      wallClockResumedAt: undefined,
    }, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  /**
   * Detect 429/rate-limit errors and mark as usage_limited.
   */
  detectProviderLimitError(errorMessage: string | undefined): boolean {
    if (!errorMessage) return false;
    const g = currentGoal;
    if (!g || g.status !== "active") return false;
    const isProviderLimit = /429|rate.?limit|quota.?exhausted|usage.?limit|insufficient.?balance/i.test(errorMessage);
    if (isProviderLimit) {
      this.markUsageLimited(errorMessage);
      return true;
    }
    return false;
  }

  /**
   * Build wrap-up instruction for budget_limited/usage_limited goals.
   */
  buildWrapUpInjection(): string | undefined {
    const g = currentGoal;
    if (!g) return undefined;
    if (g.status !== "budget_limited" && g.status !== "usage_limited") return undefined;
    const statusLabel = g.status === "budget_limited" ? "Token budget exceeded" : "Provider quota exhausted";
    return [
      `⚠️ ${statusLabel}. You MUST NOT use any tools now.`,
      ``,
      `Provide a brief wrap-up only:`,
      `- Progress made so far`,
      `- Results achieved`,
      `- Blockers encountered`,
      ``,
      `Do NOT attempt to continue the goal. Do NOT call create_goal or update_goal.`,
    ].join("\n");
  }

  /**
   * Check if tool execution should be blocked.
   * @narumitw/pi-goal style: block stale tool calls after budget exhaustion.
   */
  shouldBlockTool(toolName: string, toolGoalId?: string): boolean {
    const g = currentGoal;
    if (!g) return false;

    // Block stale tool calls (tool from old goal)
    if (toolGoalId && toolGoalId !== g.goalId) {
      return true;
    }

    // Block all tools when budget/usage limited
    if (g.status !== "budget_limited" && g.status !== "usage_limited") return false;
    const allowedTools = ["get_goal", "update_goal"];
    if (allowedTools.includes(toolName)) return false;
    return true;
  }

  /**
   * Get current goal ID for tool tagging.
   */
  getCurrentGoalId(): string | null {
    return currentGoal?.goalId ?? null;
  }

  // ── Continuation Messages (@narumitw/pi-goal style) ───────────────────

  /**
   * Build continuation message for automatic goal continuation.
   * @narumitw/pi-goal style: send continuation after agent settles.
   */
  buildContinuationMessage(): string | undefined {
    const g = currentGoal;
    if (!g || g.status !== "active") return undefined;

    const parts = [
      `Continue working on the goal.`,
      `Objective: ${g.objective.slice(0, 100)}`,
    ];

    if (g.completionCriterion) {
      parts.push(`Completion criterion: ${g.completionCriterion}`);
    }

    const budgetLine = this.budgetBandGuidance();
    if (budgetLine) {
      parts.push(budgetLine);
    }

    parts.push(`Turns: ${g.turnsUsed}, Tokens: ${g.tokensUsed}`);

    return parts.join("\n");
  }

  /**
   * Build goal ID tag for tool calls (@narumitw/pi-goal style).
   * Used to detect stale tool calls.
   */
  buildGoalIdTag(): string | undefined {
    const g = currentGoal;
    if (!g || g.status !== "active") return undefined;
    return `[goal_id:${g.goalId}]`;
  }

  // ── Prompt Injection ───────────────────────────────────────────────────

  /**
   * Budget guidance string for prompt injection (Kimi Code-style).
   */
  budgetBandGuidance(): string | undefined {
    const g = currentGoal;
    return budgetBandGuidance(g);
  }

  /** Build summary line for display */
  formatSummary(): string {
    const g = currentGoal;
    if (!g) return "No goal set.";
    const badge: Record<string, string> = {
      active: "Active", paused: "Paused", blocked: "Blocked", complete: "Complete",
      usage_limited: "Usage Limited", budget_limited: "Budget Limited",
    };
    const b = badge[g.status] ?? g.status;
    const reason = g.terminalReason ? ` (${g.terminalReason})` : "";
    const actor = g.lastActor !== "system" ? ` by ${g.lastActor}` : "";
    return `${b}: ${g.objective.slice(0, 80)}${reason}${actor}  [turns:${g.turnsUsed} tokens:${g.tokensUsed}]`;
  }

  /** Build model-facing injection text for <untrusted_objective> block */
  buildInjection(): string | undefined {
    const g = currentGoal;
    if (!g || g.status === "complete") return undefined;
    const budgetLine = this.budgetBandGuidance();
    if (g.status === "active") {
      const parts = [
        `There is an active goal, with ${g.tokensUsed} tokens used, ${g.turnsUsed} turns taken.`,
        ``,
        `<untrusted_objective>`,
        g.objective,
        `</untrusted_objective>`,
      ];
      if (g.completionCriterion) parts.push(``, `Completion criterion: ${g.completionCriterion}`);
      if (budgetLine) parts.push(``, budgetLine);
      return parts.join("\n");
    }
    if (g.status === "paused") {
      const parts = [`The goal is paused.\n\n<untrusted_objective>\n${g.objective}\n</untrusted_objective>`];
      if (budgetLine) parts.push(`\n${budgetLine}`);
      return parts.join("");
    }
    if (g.status === "blocked") {
      return `There is a goal, blocked${g.terminalReason ? ` (${g.terminalReason})` : ""}.\n\n<untrusted_objective>\n${g.objective}\n</untrusted_objective>`;
    }
    if (g.status === "budget_limited" || g.status === "usage_limited") {
      const wrapUp = this.buildWrapUpInjection();
      const parts = [
        `There is a goal, ${g.status === "budget_limited" ? "budget limited" : "usage limited"}${g.terminalReason ? ` (${g.terminalReason})` : ""}.`,
        ``,
        `<untrusted_objective>`,
        g.objective,
        `</untrusted_objective>`,
      ];
      if (wrapUp) parts.push(``, wrapUp);
      return parts.join("\n");
    }
    return undefined;
  }

  /**
   * Inject goal into system prompt messages.
   * Called from context event handler — appends goal to the system message.
   */
  injectIntoMessages(messages: Array<{ role: string; content?: any }>): void {
    const injection = this.buildInjection();
    if (!injection) return;
    // Find the system message (first with role "system" or "developer")
    for (const msg of messages) {
      if (msg.role === "system" || msg.role === "developer") {
        if (Array.isArray(msg.content)) {
          // Multi-part content: append a text part
          msg.content.push({ type: "text", text: `\n\n---\n${injection}` });
        } else if (typeof msg.content === "string") {
          msg.content += `\n\n---\n${injection}`;
        }
        return;
      }
    }
  }

  // ── Completion Statistics ─────────────────────────────────────────────

  /**
   * Format completion statistics for display.
   * Shows when goal completes.
   */
  formatCompletionStats(): string | undefined {
    const g = currentGoal;
    if (!g || g.status !== "complete") return undefined;

    const durationMs = g.wallClockMs;
    const durationMin = Math.round(durationMs / 60000);
    const durationSec = Math.round(durationMs / 1000);

    return [
      `✓ Goal completed: ${g.objective.slice(0, 60)}`,
      `  Turns: ${g.turnsUsed}`,
      `  Tokens: ${g.tokensUsed}`,
      `  Duration: ${durationMin > 0 ? `${durationMin}min` : `${durationSec}s`}`,
    ].join("\n");
  }

  // ── Persistence ────────────────────────────────────────────────────────

  /** Serialize to entry data for appendEntry persistence */
  toEntryData(): GoalSnapshot | null {
    return currentGoal;
  }

  /** Restore from entry data */
  restoreFromData(data: GoalSnapshot): void {
    setCurrentGoal(data);
  }

  /** Reconstruct goal from session entries (normalization after replay) */
  reconstructFromEntries(entries: any[]): GoalSnapshot | null {
    const goal = reconstructGoalFromEntries(entries);
    if (goal) {
      setCurrentGoal(goal);
      this.persist();
    }
    return goal;
  }

  // ── Registration helpers ───────────────────────────────────────────────

  /** Register goal tools */
  registerTools(pi: any): void {
    registerGoalTools(pi, this);
  }

  /** Register goal commands */
  registerCommands(pi: any): void {
    registerGoalCommands(pi, this);
  }
}

export const goalManager = new GoalManager();
