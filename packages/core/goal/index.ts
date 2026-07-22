// ============================================================
// Goal System — Kimi Code-style lifecycle + persistence + injection
// ============================================================

import type { GoalSnapshot, GoalStatus, GoalActor, GoalBudgetLimits } from "./types.ts";
import { goalState, setCurrentGoal, GOAL_ENTRY_TYPE } from "./types.ts";
import { computeBudgetReport, budgetBandGuidance, liveWallClockMs } from "./budget.ts";
import { goalToEntryData, goalFromEntryData, reconstructGoalFromEntries } from "./persistence.ts";
import { registerGoalTools } from "./tools.ts";
import { registerGoalCommands } from "./commands.ts";
import { autoSwitchToNext } from "./queue.ts";
import type { PersistencePort } from "../ports.ts";

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
  // P0 (3): per-goal block-attempt counter for the blocked 3-round threshold.
  private blockAttempts = new Map<string, { reason: string | undefined; count: number }>();

  /** Bind a persistence callback (called every time goal changes) */
  setPersistence(fn: (data: GoalSnapshot | null) => void): void {
    this.persistFn = fn;
  }

  /** Bind appendEntry for persistence */
  setAppendEntry(fn: (type: string, data: any) => void): void {
    this.appendEntryFn = fn;
  }

  /**
   * Bind the host persistence port (write path). The adapter implements
   * this with pi.appendEntry; the fork implements it natively. Read path
   * is tryRestoreFromEntries() below, fed with fresh entries per session.
   */
  bindPersistence(port: PersistencePort): void {
    this.setPersistence((data) => {
      if (data) port.append(GOAL_ENTRY_TYPE, data);
    });
    this.setAppendEntry((type, data) => port.append(type, data));
  }

  /** Persist current goal or null (clear) */
  private persist(): void {
    if (this.persistFn) this.persistFn(goalState.current);
    // Also persist via appendEntry if available
    if (this.appendEntryFn && goalState.current) {
      const data = goalToEntryData(goalState.current);
      if (data) {
        this.appendEntryFn(GOAL_ENTRY_TYPE, data);
      }
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Create a new active goal.
   * P0 (1): active guard — refuses to create when an active goal already exists,
   * unless `replace=true` is passed (caller explicitly acknowledges the overwrite).
   * Throws a descriptive Error so tool/command layers can surface it to the model/user.
   */
  createGoal(
    objective: string,
    completionCriterion?: string,
    budgetLimits?: GoalBudgetLimits,
    actor: GoalActor = "user",
    replace: boolean = false,
  ): GoalSnapshot {
    // P0 (1): active guard
    if (goalState.current && goalState.current.status === "active" && !replace) {
      throw new Error("已有 active 目标,使用 replace=true 或 /goal replace 才能覆盖");
    }
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
    return goalState.current;
  }

  /** Apply actor+timestamp to any snapshot patch */
  private withActor(patch: Partial<GoalSnapshot>, actor: GoalActor): Partial<GoalSnapshot> {
    return { ...patch, lastActor: actor, lastActedAt: new Date().toISOString() };
  }

  /**
   * Update goal textual fields.
   * P0 (6): default to preserving the existing status; only override it when the
   * caller explicitly passes a `status` value. Passing `undefined` is treated as
   * "no override" and keeps the current status (NOT a forced reset to active).
   */
  editGoal(
    objective: string,
    completionCriterion: string | undefined,
    actor: GoalActor = "user",
    status: GoalStatus | undefined = undefined,
  ): GoalSnapshot | null {
    const g = goalState.current;
    if (!g) return null;
    const patch: Partial<GoalSnapshot> = { objective, completionCriterion };
    if (status !== undefined) patch.status = status;
    const updated = cloneSnapshot(g, this.withActor(patch, actor));
    setCurrentGoal(updated);
    this.persist();
    return updated;
  }

  /** Pause → paused (Kimi Code-style wall clock handling) */
  pause(actor: GoalActor = "user"): GoalSnapshot | null {
    const g = goalState.current;
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
    const g = goalState.current;
    if (!g || g.status === "complete") return null;

    const updated = cloneSnapshot(g, this.withActor({
      status: "active" as GoalStatus,
      wallClockResumedAt: Date.now(),
      terminalReason: undefined, // Clear stop reason on resume
    }, actor));
    setCurrentGoal(updated);
    this.persist();
    // P0 (3): a resume from a (soft or hard) blocked state starts a fresh
    // 3-round window for any future block attempts.
    this.blockAttempts.delete(g.goalId);
    return updated;
  }

  /**
   * Block — with optional budget-limit check.
   * P0 (3): 3-round threshold. The same `reason` must be reported 3 consecutive
   * times before the goal actually enters the `blocked` status. The first two
   * attempts keep the existing status and only log internally; the counter
   * resets when `reason` changes (new reason starts a fresh 3-round window).
   * Once the goal is actually blocked, the counter for that goal is cleared.
   */
  block(reason?: string, actor: GoalActor = "system"): GoalSnapshot | null {
    const g = goalState.current;
    if (!g || g.status === "complete") return null;

    // P0 (3): block-attempt accounting
    const key = g.goalId;
    const prev = this.blockAttempts.get(key);
    let count = 1;
    if (prev && prev.reason === reason) {
      count = prev.count + 1;
    }
    this.blockAttempts.set(key, { reason, count });

    if (count < 3) {
      // Keep existing status; only log internally. Do NOT fold wall clock since
      // the goal's running state is unchanged.
      // eslint-disable-next-line no-console
      console.warn(
        `[goal] block attempt ${count}/3 for goal ${key} (reason=${JSON.stringify(reason)}); status remains "${g.status}"`,
      );
      return g;
    }

    // 3rd consecutive identical block attempt → actually enter blocked.
    // Fold live wall clock interval (matches prior behavior on real block).
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
    // Clear the counter once the goal is actually blocked.
    this.blockAttempts.delete(key);
    return updated;
  }

  /**
   * P0 (2): placeholder criterion verifier. The extension cannot actually run
   * verification today, so this only asserts the criterion is a non-empty string
   * (i.e. "criterion declared"). When a real verification interface is wired in
   * later, replace this body with a real check. `verified=true` from the caller
   * is what currently gates completion when a criterion is declared.
   */
  private verifyCriterion(criterion: string | undefined): boolean {
    return typeof criterion === "string" && criterion.trim().length > 0;
  }

  /**
   * Mark complete. Kimi Code: preserves completionSummary.
   * P0 (2): when `goal.completionCriterion` is declared (non-empty), the caller
   * MUST pass `verified=true` to complete; otherwise completion is refused and
   * the goal is left untouched. When no criterion is declared, completion is
   * allowed as before.
   */
  complete(actor: GoalActor = "user", summary?: string, verified: boolean = false): GoalSnapshot | null {
    const g = goalState.current;
    if (!g) return null;

    // P0 (2): criterion gate
    if (g.completionCriterion && g.completionCriterion.trim().length > 0) {
      if (!verified) {
        // Need explicit verification; do not change the goal.
        return null;
      }
      // Caller asserts completion; run placeholder check for parity with the
      // future real verifier. A declared-but-empty criterion would fail here,
      // which is the intended "criterion must actually be declared" rule.
      if (!this.verifyCriterion(g.completionCriterion)) {
        return null;
      }
    } else {
      // No criterion declared → free to complete. Still run the placeholder so
      // the code path is exercised; it returns false for empty/undefined and
      // we simply ignore that here (no-criterion ⇒ allowed).
      this.verifyCriterion(g.completionCriterion);
    }

    const now = Date.now();
    let wallClockMs = g.wallClockMs;
    if (g.status === "active" && g.wallClockResumedAt !== undefined) {
      wallClockMs += Math.max(0, now - g.wallClockResumedAt);
    }

    const updated = cloneSnapshot(g, this.withActor({
      status: "complete" as GoalStatus,
      wallClockMs,
      wallClockResumedAt: undefined,
      completionSummary: summary || g.completionSummary,
    }, actor));
    setCurrentGoal(updated);
    this.persist();

    const nextItem = autoSwitchToNext();
    if (nextItem) {
      this.createGoal(nextItem.objective, nextItem.completionCriterion, nextItem.budgetLimits, "runtime");
    }

    return updated;
  }

  /**
   * Clear the goal.
   * Also appends a tombstone entry (status "complete"): persist() skips a
   * null current goal, so without a tombstone the cleared goal's last entry
   * would remain the most recent one — and any restore-from-entries (next
   * session start, or the restore-if-empty at goal tool entry points) would
   * resurrect the cleared goal with its stale counters. Kimi Code semantics:
   * an ended goal never rests on disk as restorable state.
   */
  clear(actor: GoalActor = "user"): void {
    const g = goalState.current;
    if (g) this.blockAttempts.delete(g.goalId);
    setCurrentGoal(null);
    this.persist();
    if (g && this.appendEntryFn) {
      const data = goalToEntryData(g);
      if (data) {
        this.appendEntryFn(GOAL_ENTRY_TYPE, { ...data, status: "complete" as GoalStatus });
      }
    }
  }

  /**
   * Pause on user interrupt (Kimi Code-style pauseOnInterrupt).
   * Called when user presses Esc, Ctrl+C, or any turn-level cancellation.
   */
  pauseOnInterrupt(reason?: string): GoalSnapshot | null {
    const g = goalState.current;
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
    const g = goalState.current;
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
    const g = goalState.current;
    if (!g || g.status !== "active") return;

    const newTokens = g.tokensUsed + Math.max(0, delta);
    setCurrentGoal(cloneSnapshot(g, {
      tokensUsed: newTokens,
    }));
    // Silent persist (no UI update)
    if (this.persistFn) this.persistFn(goalState.current);
  }

  /**
   * Increment turn count (Kimi Code-style).
   */
  incrementTurn(): void {
    const g = goalState.current;
    if (!g || g.status !== "active") return;

    const now = Date.now();
    const deltaMs = g.wallClockResumedAt ? Math.max(0, now - g.wallClockResumedAt) : 0;

    setCurrentGoal(cloneSnapshot(g, {
      turnsUsed: g.turnsUsed + 1,
      wallClockMs: g.wallClockMs + deltaMs,
      wallClockResumedAt: now,
    }));
    // Silent persist
    if (this.persistFn) this.persistFn(goalState.current);
  }

  /**
   * Set budget limits on the current goal (Kimi Code-style).
   */
  setBudgetLimits(limits: GoalBudgetLimits, actor: GoalActor = "user"): GoalSnapshot | null {
    const g = goalState.current;
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
    const g = goalState.current;
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
    const g = goalState.current;
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
    const g = goalState.current;
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
    const g = goalState.current;
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
    const g = goalState.current;
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
    return goalState.current?.goalId ?? null;
  }

  // ── Continuation Messages (@narumitw/pi-goal style) ───────────────────

  /**
   * Build continuation message for automatic goal continuation.
   * @narumitw/pi-goal style: send continuation after agent settles.
   */
  buildContinuationMessage(): string | undefined {
    const g = goalState.current;
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
    const g = goalState.current;
    if (!g || g.status !== "active") return undefined;
    return `[goal_id:${g.goalId}]`;
  }

  // ── Prompt Injection ───────────────────────────────────────────────────

  /**
   * Budget guidance string for prompt injection (Kimi Code-style).
   */
  budgetBandGuidance(): string | undefined {
    const g = goalState.current;
    return budgetBandGuidance(g);
  }

  /** Build summary line for display */
  formatSummary(): string {
    const g = goalState.current;
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

  /** Build a GoalPanel-style formatted report (Kimi Code-style) */
  formatGoalPanel(goal?: GoalSnapshot): string {
    const g = goal || goalState.current;
    if (!g) return "No goal set.";

    const lines: string[] = [];

    // Objective (blockquote style)
    lines.push(`\u258C ${g.objective}`);
    
    // Completion criterion
    if (g.completionCriterion) {
      lines.push(`\u258C \u2713 ${g.completionCriterion}`);
    }
    
    lines.push("");

    // Status
    const statusDot = g.status === "active" ? "\u25CF" : g.status === "blocked" ? "\u25CF" : "\u25CB";
    lines.push(`${statusDot} Status     ${g.status}${g.terminalReason ? ` \u2014 ${g.terminalReason}` : ""}`);
    
    // Running duration
    const durationMs = liveWallClockMs(g);
    const mins = Math.floor(durationMs / 60000);
    const secs = Math.floor((durationMs % 60000) / 1000);
    const durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    lines.push(`  Running    ${durationStr}`);
    
    // Turns
    const turnBudget = g.budgetLimits?.turnBudget;
    const turnsStr = turnBudget ? `${g.turnsUsed}/${turnBudget}` : `${g.turnsUsed}`;
    lines.push(`  Turns      ${turnsStr}`);
    
    // Tokens
    if (g.tokensUsed > 0) {
      const tokStr = g.tokensUsed < 1000 ? `${g.tokensUsed}` : g.tokensUsed < 10000 ? `${(g.tokensUsed / 1000).toFixed(1)}k` : `${Math.round(g.tokensUsed / 1000)}k`;
      lines.push(`  Tokens     ${tokStr}`);
    }
    
    // Stop condition
    if (turnBudget) {
      lines.push(`  Stop       after ${turnBudget} turns (${g.turnsUsed}/${turnBudget})`);
    } else if (g.budgetLimits?.tokenBudget) {
      lines.push(`  Stop       after ${g.budgetLimits.tokenBudget} tokens`);
    } else if (g.budgetLimits?.wallClockBudgetMs) {
      const wallMins = Math.floor(g.budgetLimits.wallClockBudgetMs / 60000);
      lines.push(`  Stop       after ${wallMins} minutes`);
    } else {
      lines.push(`  Stop       (no stop condition)`);
    }

    return lines.join("\n");
  }

  /**
   * Build Goal Badge for footer (Kimi Code-style).
   * Format: [goal ● active · 4m · 7/20 turns]
   */
  buildFooterBadge(): string | undefined {
    const g = goalState.current;
    if (!g || g.status === "complete") return undefined;

    // Status dot color: active=primary, blocked=warning, paused=muted
    const dot = g.status === "active" ? "●" : g.status === "blocked" ? "●" : "○";
    
    // Duration
    const durationMs = liveWallClockMs(g);
    const durationMin = Math.floor(durationMs / 60000);
    const durationSec = Math.floor((durationMs % 60000) / 1000);
    const duration = durationMin > 0 ? `${durationMin}m` : `${durationSec}s`;
    
    // Turns (with budget if set)
    const turnBudget = g.budgetLimits?.turnBudget;
    const turns = turnBudget ? `${g.turnsUsed}/${turnBudget}` : `${g.turnsUsed}`;
    
    return `[goal ${dot} ${g.status} · ${duration} · ${turns} turns]`;
  }

  /**
   * Get status color for Goal Badge (for theme integration).
   */
  getFooterBadgeColor(): string {
    const g = goalState.current;
    if (!g) return "muted";
    switch (g.status) {
      case "active": return "accent";
      case "blocked": return "warning";
      case "usage_limited":
      case "budget_limited": return "error";
      default: return "muted";
    }
  }

  /** Build model-facing injection text for <untrusted_objective> block */
  buildInjection(): string | undefined {
    const g = goalState.current;
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
    const g = goalState.current;
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
    return goalState.current;
  }

  /**
   * Restore from entry data.
   * Monotonic counters: when the in-memory goal is the same goalId, the
   * accounting counters never regress — a stale persisted entry must not
   * pull turnsUsed / tokensUsed / wallClockMs backwards (that regression is
   * what made the footer badge bounce between the newer in-memory value and
   * the older entry value). A different goalId (session switch) replaces
   * wholesale.
   */
  restoreFromData(data: GoalSnapshot): void {
    const cur = goalState.current;
    if (cur && cur.goalId === data.goalId) {
      setCurrentGoal({
        ...data,
        turnsUsed: Math.max(cur.turnsUsed, data.turnsUsed ?? 0),
        tokensUsed: Math.max(cur.tokensUsed, data.tokensUsed ?? 0),
        wallClockMs: Math.max(cur.wallClockMs, data.wallClockMs ?? 0),
      });
      return;
    }
    setCurrentGoal(data);
  }

  /**
   * Try to restore goal from session entries (handles host hot-reload).
   * Core takes plain entries — the host reads them from its session
   * manager and passes them in, keeping core free of session APIs.
   *
   * Restore-if-empty only: when an in-memory goal exists this is a no-op,
   * so it can never clobber newer live state with an older entry. When the
   * latest goal entry is a "complete" tombstone (goal completed or cleared),
   * there is nothing to restore — do NOT fall through to older entries.
   */
  tryRestoreFromEntries(entries: any[]): boolean {
    if (goalState.current) return true;
    try {
      if (!entries) return false;
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e.type === "custom" && e.customType === GOAL_ENTRY_TYPE && e.data) {
          // Tombstone: an ended goal is not restorable (Kimi Code: complete
          // never rests on disk).
          if (e.data.status === "complete") return false;
          this.restoreFromData(e.data);
          return true;
        }
      }
    } catch { /* not critical */ }
    return false;
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
