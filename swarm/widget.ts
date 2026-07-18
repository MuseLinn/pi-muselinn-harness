// ============================================================
// Swarm Mode — TUI Widget (Kimi Code-style braille grid, tick-driven)
// ============================================================

import type { SwarmState, AgentStatus, SubAgentTask } from "./types";
import { AGENT_SWARM_LEFT_INDENT, STATUS_BAR_CHAR, FRAME_INTERVAL_MS, currentGoal } from "./types";
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
): { lines: string[]; refreshInterval: number } | null {
  if (!state || state.tasks.length === 0 || state.status === "pending") return null;

  const ts = nowMs ?? Date.now();
  const total = state.tasks.length;
  const done = state.tasks.filter((t) => t.status === "done").length;
  const running = state.tasks.filter((t) => t.status === "running").length;
  const failed = state.tasks.filter((t) => t.status === "failed").length;
  const aborted = state.tasks.filter((t) => t.status === "aborted").length;

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
  const termWidth = process?.stdout?.columns || 100;
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
      const label = cellLabel(t, layout.cellWidth, theme);
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
      )} ${theme.fg("muted", currentGoal.objective.slice(0, termWidth - 30))}`
    : null;

  // ---- Status Line ----
  const statusLine = buildStatusLine(theme, done, running, failed, aborted, total, cancelIsPending);
  lines.push(statusLine);
  if (goalLine) lines.push(goalLine);

  // ---- Cancel hint ----
  if (cancelIsPending && state.status === "running") {
    lines.push(theme.fg("error", " /cancel again to cancel the swarm"));
  }

  const refreshInterval = hasAnimation ? FRAME_INTERVAL_MS : 0;
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
): string {
  const phases: Array<{ key: string; count: number; color: string }> = [];
  if (done > 0) phases.push({ key: "completed", count: done, color: "success" });
  if (running > 0) phases.push({ key: "working", count: running, color: "warning" });
  const queued = total - done - running - failed - aborted;
  if (queued > 0) phases.push({ key: "queued", count: queued, color: "muted" });
  if (failed > 0) phases.push({ key: "failed", count: failed, color: "error" });
  if (aborted > 0) phases.push({ key: "aborted", count: aborted, color: "warning" });

  if (phases.length === 0) return "";

  // Moon spinner (Kimi Code-style)
  const MOON_PHASES = ["\uD83C\uDF11", "\uD83C\uDF12", "\uD83C\uDF13", "\uD83C\uDF14", "\uD83C\uDF15", "\uD83C\uDF16", "\uD83C\uDF17", "\uD83C\uDF18"];
  const moonFrame = running > 0 ? MOON_PHASES[Math.floor(Date.now() / 120) % MOON_PHASES.length] + " " : "";

  const label = moonFrame + (running > 0 ? "Working..." : done === total ? "Completed." : "Failed.");

  const barWidth = 30;
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
