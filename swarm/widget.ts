// ============================================================
// Swarm Mode — TUI Widget (Kimi Code-style braille grid)
// Renders through the pi-tui Component protocol (SwarmWidgetComponent,
// same Container-based pattern as TasksBrowserComponent); the refresh
// timer ticks at FRAME_INTERVAL_MS and is fingerprint-gated.
// ============================================================

import { Container, truncateToWidth } from "@earendil-works/pi-tui";
import type { SwarmState, AgentStatus, SubAgentTask } from "./types";
import { AGENT_SWARM_LEFT_INDENT, STATUS_BAR_CHAR, FRAME_INTERVAL_MS, currentGoal, COMPLETE_FILL_MS, MIN_LABEL_WIDTH } from "./types";
import { accumulatedBrailleBar, computeProgress, needsAnimation, calculateGridLayout, visibleWidth, gradientText, AGENT_SWARM_TITLE_ACCENT_BIAS } from "./helpers";

/**
 * Build goal status line for widget display.
 * @narumitw/pi-goal style: show goal status in widget.
 */
export function buildGoalStatus(goal: typeof currentGoal): string {
  if (!goal) return "";
  const badge = goal.status === "active" ? "●" :
                goal.status === "paused" ? "○" :
                goal.status === "blocked" ? "◆" :
                goal.status === "usage_limited" ? "⚠" :
                goal.status === "budget_limited" ? "⚠" :
                goal.status === "complete" ? "✓" : "○";
  const reason = goal.terminalReason ? ` (${goal.terminalReason})` : "";
  return `${badge} Goal: ${goal.objective.slice(0, 40)}${reason}`;
}

export function buildWidgetLines(
  state: SwarmState | null,
  theme: any,
  cancelIsPending: boolean,
  nowMs?: number,
  width?: number,
): { lines: string[]; refreshInterval: number } | null {
  if (!state || state.tasks.length === 0 || state.status === "pending") return null;

  const ts = nowMs ?? Date.now();
  const total = state.tasks.length;
  // Single-pass status counting (was 4× filter().length per frame).
  let done = 0, running = 0, failed = 0, aborted = 0;
  for (const t of state.tasks) {
    if (t.status === "done") done++;
    else if (t.status === "running") running++;
    else if (t.status === "failed") failed++;
    else if (t.status === "aborted") aborted++;
  }

  // Increment ticks for all running/pending tasks (once per frame)
  const hasAnimation = needsAnimation(state.tasks, ts);

  const lines: string[] = [];

  // ---- Header ----
  const title = theme.bold(gradientText(
    "Agent Swarm",
    "#4FA8FF", // Kimi primary (blue)
    "#5BC0BE", // Kimi accent (teal)
    AGENT_SWARM_TITLE_ACCENT_BIAS,
  ));
  const desc = state.name ? theme.fg("muted", ` ─ ${state.name}`) : "";
  const header = `─ ${title}${desc}`;
  lines.push(header);

  // ---- Goal Badge (Kimi Code-style) ----
  if (currentGoal && currentGoal.status !== "complete") {
    const dot = currentGoal.status === "active" ? "●" : currentGoal.status === "blocked" ? "●" : "○";
    const dotColor = currentGoal.status === "active" ? "accent" : currentGoal.status === "blocked" ? "warning" : "muted";
    const durationMs = currentGoal.wallClockMs;
    const durationMin = Math.floor(durationMs / 60000);
    const duration = durationMin > 0 ? `${durationMin}m` : `${Math.floor(durationMs / 1000)}s`;
    const turnBudget = currentGoal.budgetLimits?.turnBudget;
    const turns = turnBudget ? `${currentGoal.turnsUsed}/${turnBudget}` : `${currentGoal.turnsUsed}`;
    lines.push(`  ${theme.fg(dotColor, dot)} ${theme.fg("text", currentGoal.status)} · ${duration} · ${turns} turns`);
  }

  // ---- Grid ----
  // Width is the real rendered widget width passed down from the pi-tui
  // Component render(width) contract; stdout.columns is only a fallback for
  // direct calls that happen before the first render.
  const termWidth = width ?? process?.stdout?.columns ?? 100;
  const gridHeight = 10;
  const layout = calculateGridLayout(total, termWidth - 4, gridHeight);

  for (let row = 0; row < layout.rows; row++) {
    const cells: string[] = [];
    for (let col = 0; col < layout.columns; col++) {
      const idx = row * layout.columns + col;
      if (idx >= total) continue;
      const t = state.tasks[idx];
      const progress = computeProgress(t);
      const bar = accumulatedBrailleBar(progress, layout.barCells, t.status, t.completedAtMs, ts);
      // Label budget = cell width minus the id + braille bar prefix and the
      // two separating spaces actually emitted below. Sizing the label to the
      // full cellWidth let extreme labels overflow into the neighbour cell
      // (only the line-level truncateToWidth backstop caught it).
      const labelMaxWidth = Math.max(
        MIN_LABEL_WIDTH,
        layout.cellWidth - visibleWidth(t.id) - visibleWidth(bar) - 2,
      );
      const label = cellLabel(t, labelMaxWidth, theme);
      const cell = `${theme.fg("muted", t.id)} ${colorBar(bar, t.status, theme)} ${label}`;
      cells.push(cell);
    }
    lines.push(AGENT_SWARM_LEFT_INDENT + cells.join("  "));
  }

  // ---- Goal Status (if active) ----
  const goalLine = currentGoal && currentGoal.status !== "complete"
    ? ` ${theme.fg("accent", "Goal:")} ${theme.fg(
        currentGoal.status === "active" ? "success" : currentGoal.status === "blocked" ? "warning" : "muted",
        currentGoal.status,
      )} ${theme.fg("muted", currentGoal.objective.slice(0, Math.max(0, termWidth - 30)))}`
    : null;

  // ---- Status Line ----
  // Status bar width adapts to the terminal: 30 cells at ~100 columns
  // (matches the previous hard-coded look), clamped to 10..60 so narrow
  // terminals stay aligned and wide terminals don't get an oversized bar.
  const barWidth = Math.max(10, Math.min(60, Math.floor(termWidth * 0.3)));
  const statusLine = buildStatusLine(theme, done, running, failed, aborted, total, cancelIsPending, ts, barWidth);
  lines.push(statusLine);
  if (goalLine) lines.push(goalLine);

  // ---- Cancel hint ----
  if (cancelIsPending && state.status === "running") {
    lines.push(theme.fg("error", " /cancel again to cancel the swarm"));
  }

  // Keep the frame timer alive while the swarm is still running: the moon
  // spinner in the status line advances purely from the frame timestamp
  // (already covered by the widget fingerprint), so a live timer at
  // FRAME_INTERVAL_MS is all that is needed to keep it turning. Once the
  // swarm leaves "running" (or nothing is running) and the completed-fill
  // animation has settled, refreshInterval drops to 0 and the caller's
  // timer self-stops as before.
  const swarmInFlight = state.status === "running" && running > 0;
  const refreshInterval = hasAnimation || swarmInFlight ? FRAME_INTERVAL_MS : 0;
  return { lines, refreshInterval };
}

export function colorBar(bar: string, status: AgentStatus, theme: any): string {
  switch (status) {
    case "running":
      return theme.fg("warning", bar);
    case "done":
      return theme.fg("success", bar);
    case "failed":
      return theme.fg("error", bar);
    case "aborted":
      return theme.fg("warning", bar);
    default:
      return theme.fg("muted", bar);
  }
}

export function cellLabel(t: SubAgentTask, maxWidth: number, theme: any): string {
  const statusSymbols: Record<AgentStatus, string> = {
    pending: "○",
    running: "◉",
    done: "✓",
    failed: "✗",
    aborted: "⊘",
  };
  const sym = statusSymbols[t.status] || "○";
  // Show short model name if different items use different models
  const modelShort = t.model?.split("-").slice(-1)?.[0] || "";
  let label = `${sym} `;

  switch (t.status) {
    case "done":
      label += t.currentAction?.slice(0, maxWidth - 4) || "Completed.";
      break;
    case "failed":
      label += theme.fg("error", t.error?.slice(0, maxWidth - 4) || "Failed.");
      break;
    case "aborted":
      label += theme.fg("warning", "Aborted.");
      break;
    case "running":
      label += t.currentAction?.slice(0, maxWidth - 4) || "Working...";
      break;
    default:
      label += "Queued...";
  }

  // Append model tag if space allows
  const remaining = maxWidth - visibleWidth(label) - 2;
  if (remaining > 4 && modelShort && modelShort.length < remaining) {
    label += theme.fg("dim", ` [${modelShort}]`);
  }

  return label.slice(0, maxWidth);
}

export function buildStatusLine(
  theme: any,
  done: number,
  running: number,
  failed: number,
  aborted: number,
  total: number,
  _cancelIsPending: boolean,
  nowMs?: number,
  barWidth = 30,
): string {
  const phases: Array<{ key: string; count: number; color: string }> = [];
  if (done > 0) phases.push({ key: "completed", count: done, color: "success" });
  if (running > 0) phases.push({ key: "working", count: running, color: "warning" });
  const queued = total - done - running - failed - aborted;
  if (queued > 0) phases.push({ key: "queued", count: queued, color: "muted" });
  if (failed > 0) phases.push({ key: "failed", count: failed, color: "error" });
  if (aborted > 0) phases.push({ key: "aborted", count: aborted, color: "warning" });

  if (phases.length === 0) return "";

  // Moon spinner (Kimi Code-style). Uses the caller-supplied frame timestamp
  // so re-renders between timer ticks never advance the phase; once nothing
  // is running the moon disappears and the label settles on its final text.
  const MOON_PHASES = ["\uD83C\uDF11", "\uD83C\uDF12", "\uD83C\uDF13", "\uD83C\uDF14", "\uD83C\uDF15", "\uD83C\uDF16", "\uD83C\uDF17", "\uD83C\uDF18"];
  const moonFrame = running > 0 ? MOON_PHASES[Math.floor((nowMs ?? Date.now()) / 120) % MOON_PHASES.length] + " " : "";

  const label = moonFrame + (running > 0 ? "Working..." : done === total ? "Completed." : "Failed.");

  const totalCount = phases.reduce((s, p) => s + p.count, 0);
  const segments = phases.map((p) => {
    const w = Math.max(1, Math.round((p.count / totalCount) * barWidth));
    return theme.fg(p.color as any, STATUS_BAR_CHAR.repeat(w));
  });

  return `${theme.fg(
    running > 0 ? "warning" : done === total ? "success" : "error",
    ` ${label}`,
  )} ${segments.join("")}`;
}

/**
 * Cheap state fingerprint covering everything that can change the rendered
 * widget lines. Callers (the per-frame refresh timers) compare consecutive
 * fingerprints and skip the full buildWidgetLines rebuild + TUI invalidate
 * when nothing visible changed.
 *
 * Includes animation phases so braille fill / moon spinner frames still
 * trigger rebuilds while animating; once all tasks settle (refreshInterval
 * would be 0) the fingerprint is stable, letting the existing timer-stop
 * logic fire on the frame where the phase flips.
 *
 * Returns null exactly when buildWidgetLines would return null.
 */
export function computeWidgetFingerprint(
  state: SwarmState | null,
  cancelIsPending: boolean,
  nowMs?: number,
  width?: number,
): string | null {
  if (!state || state.tasks.length === 0 || state.status === "pending") return null;
  const ts = nowMs ?? Date.now();
  const termWidth = width ?? process?.stdout?.columns ?? 100;

  let fp = `${state.name}|${state.status}|${cancelIsPending ? 1 : 0}|${termWidth}`;

  let running = 0;
  for (const t of state.tasks) {
    if (t.status === "running") running++;
    // Quantized fill-animation phase: changes while the completed-fill
    // animation runs, then saturates to -1 (stable) once it finishes.
    let fillPhase = -1;
    if ((t.status === "done" || t.status === "failed") && t.completedAtMs !== undefined) {
      const elapsed = ts - t.completedAtMs;
      if (elapsed >= 0 && elapsed < COMPLETE_FILL_MS) fillPhase = Math.floor(elapsed / 40);
    }
    fp += `#${t.id}:${t.status}:${t.toolCalls}/${t.estimatedTotalCalls}:${t.currentAction ?? ""}:${t.error ?? ""}:${fillPhase}`;
  }

  // Moon spinner phase — only rendered while something is running.
  if (running > 0) fp += `|moon:${Math.floor(ts / 120)}`;

  // Goal badge/status lines (duration is floored to seconds/minutes).
  if (currentGoal && currentGoal.status !== "complete") {
    fp += `|goal:${currentGoal.status}:${Math.floor(currentGoal.wallClockMs / 1000)}:${currentGoal.turnsUsed}:${currentGoal.budgetLimits?.turnBudget ?? ""}:${currentGoal.objective}`;
  }

  return fp;
}

// ============================================================
// SwarmWidgetComponent — pi-tui Component wrapping the swarm widget
// ============================================================

export type SwarmWidgetUpdate = "changed" | "unchanged" | "empty";

/**
 * pi-tui Component for the swarm progress widget, using the same
 * Container-based architecture as TasksBrowserComponent so both surfaces
 * share one Component protocol (`render(width): string[]` + `invalidate()`).
 *
 * The widget is registered through ctx.ui.setWidget(key, factory); pi mounts
 * the returned component in a Container whose render(width) is invoked by the
 * TUI root with the full terminal width. Lines are still hand-built ANSI
 * (theme.fg / gradientText / braille grid) — pi-tui's Text component would
 * word-wrap long lines and pad to full width, which breaks the braille grid
 * on narrow terminals, so render() only truncates to the viewport width.
 *
 * Time-purity: render() never reads the clock. Visible line content is
 * rebuilt only by update() (fingerprint-gated, driven by the refresh timer
 * and progress callbacks) or by a viewport width change, and width-change
 * rebuilds reuse the timestamp of the last update. Once the swarm settles
 * (refreshIntervalMs === 0) and the timer stops, re-renders triggered by
 * unrelated UI activity repaint the cached frame verbatim — the moon
 * spinner / fill animation stay frozen on their last frame.
 */
export class SwarmWidgetComponent extends Container {
  private readonly getState: () => SwarmState | null;
  private readonly theme: any;
  private readonly isCancelPending: () => boolean;

  private lines: string[] = [];
  /** Last viewport width seen by render(); 0 = never rendered. */
  private renderWidth = 0;
  /** Timestamp of the last update() that produced the cached lines. */
  private lastBuildMs = 0;
  private lastFingerprint: string | null = null;
  /** Refresh cadence from the last build; 0 = animation settled. */
  refreshIntervalMs = 0;

  constructor(
    getState: () => SwarmState | null,
    theme: any,
    isCancelPending: () => boolean,
  ) {
    super();
    this.getState = getState;
    this.theme = theme;
    this.isCancelPending = isCancelPending;
  }

  /** Width used for layout before the first render() delivers the real one. */
  private effectiveWidth(): number {
    return this.renderWidth > 0 ? this.renderWidth : (process?.stdout?.columns ?? 100);
  }

  /**
   * Fingerprint-gated rebuild. Called by the refresh timer and by subagent
   * progress callbacks. Returns "changed" when the visible lines were
   * rebuilt, "unchanged" when the fingerprint matched the cached frame, and
   * "empty" when there is nothing to display (no active swarm state).
   */
  update(nowMs?: number): SwarmWidgetUpdate {
    const ts = nowMs ?? Date.now();
    const width = this.effectiveWidth();
    const state = this.getState();
    const fp = computeWidgetFingerprint(state, this.isCancelPending(), ts, width);
    if (fp !== null && fp === this.lastFingerprint) return "unchanged";
    const result = buildWidgetLines(state, this.theme, this.isCancelPending(), ts, width);
    if (!result || result.lines.length === 0) return "empty";
    this.lastFingerprint = fp;
    this.lastBuildMs = ts;
    this.lines = result.lines;
    this.refreshIntervalMs = result.refreshInterval;
    return "changed";
  }

  override render(width: number): string[] {
    if (width > 0 && width !== this.renderWidth) {
      this.renderWidth = width;
      if (this.lines.length > 0) {
        // Rebuild the layout for the new width with the ORIGINAL build
        // timestamp so time-driven frames (moon spinner, fill animation)
        // stay frozen between updates.
        const state = this.getState();
        const result = buildWidgetLines(state, this.theme, this.isCancelPending(), this.lastBuildMs, width);
        if (result && result.lines.length > 0) {
          this.lines = result.lines;
          this.refreshIntervalMs = result.refreshInterval;
          this.lastFingerprint = computeWidgetFingerprint(state, this.isCancelPending(), this.lastBuildMs, width);
        }
      }
    }
    // Final safety: never emit a line wider than the viewport.
    return this.lines.map((l) => truncateToWidth(l, width));
  }
}
