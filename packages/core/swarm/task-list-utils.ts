// ============================================================
// Task Browser — pure helpers (status glyphs, overflow collapse,
// key routing). No pi-tui imports: unit tests load this module
// directly through the jiti CJS loader. The component in
// task-browser.ts injects a real KeyMatchFn built on pi-tui's
// matchesKey + KeybindingsManager.
// ============================================================

import type { SubAgentTask } from "./types.ts";

// ── Status glyphs (rpiv-todo semantics) ──────────────────────
// pending ○ / running ◐ / done ✓ / failed ✗ / aborted ▲

export function statusGlyph(status: string): string {
  switch (status) {
    case "done": return "✓";
    case "failed": return "✗";
    case "aborted": return "▲";
    case "running": return "◐";
    default: return "○";
  }
}

export function statusColorName(status: string): "success" | "text" | "error" | "warning" {
  switch (status) {
    case "done": return "success";
    case "running": return "warning";
    case "failed": return "error";
    case "aborted": return "warning";
    default: return "text";
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case "done": return "completed";
    case "failed": return "failed";
    case "aborted": return "aborted";
    case "running": return "running";
    default: return "pending";
  }
}

export function isTerminalStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "aborted";
}

export function compareTasks(a: SubAgentTask, b: SubAgentTask): number {
  const aTerminal = isTerminalStatus(a.status);
  const bTerminal = isTerminalStatus(b.status);
  if (aTerminal !== bTerminal) return aTerminal ? 1 : -1;
  if (!aTerminal) return (a.startTime || 0) - (b.startTime || 0);
  return (b.endTime || 0) - (a.endTime || 0);
}

// ── Overflow collapse (rpiv-todo semantics) ──────────────────
// When the visible window cannot hold the list, reserve one row for
// a summary and keep tasks by priority — running first, then pending,
// then failed/aborted, done last (done is dropped first). The
// currently selected task is always kept. Display order is preserved.

export interface CollapseCounts {
  done: number;
  running: number;
  pending: number;
  failed: number;
  aborted: number;
}

export interface CollapseResult<T> {
  visible: T[];
  hiddenTotal: number;
  hidden: CollapseCounts;
}

function collapseRank(status: string): number {
  switch (status) {
    case "running": return 0;
    case "pending": return 1;
    case "failed": return 2;
    case "aborted": return 3;
    case "done": return 4;
    default: return 1;
  }
}

function emptyCounts(): CollapseCounts {
  return { done: 0, running: 0, pending: 0, failed: 0, aborted: 0 };
}

function bump(counts: CollapseCounts, status: string): void {
  switch (status) {
    case "done": counts.done++; break;
    case "running": counts.running++; break;
    case "failed": counts.failed++; break;
    case "aborted": counts.aborted++; break;
    default: counts.pending++; break;
  }
}

/**
 * Collapse a task list into at most `maxRows` rows plus (on overflow)
 * a summary line described by the returned hidden counts. `keepIndex`
 * (selection) is force-kept visible.
 */
export function collapseTaskList<T extends { status: string }>(
  tasks: readonly T[],
  maxRows: number,
  keepIndex?: number,
): CollapseResult<T> {
  if (maxRows <= 0 || tasks.length === 0) {
    const hidden = emptyCounts();
    for (const t of tasks) bump(hidden, t.status);
    return { visible: [], hiddenTotal: tasks.length, hidden };
  }
  if (tasks.length <= maxRows) {
    return { visible: [...tasks], hiddenTotal: 0, hidden: emptyCounts() };
  }

  // Reserve one row for the "+N more" summary.
  const budget = Math.max(1, maxRows - 1);
  const kept = new Set<number>();

  // Selection is always visible.
  if (keepIndex !== undefined && keepIndex >= 0 && keepIndex < tasks.length) {
    kept.add(keepIndex);
  }

  // Fill remaining slots by priority rank (running first, done last),
  // stable within a rank by list order.
  const order = tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => collapseRank(a.t.status) - collapseRank(b.t.status) || a.i - b.i);
  for (const { i } of order) {
    if (kept.size >= budget) break;
    kept.add(i);
  }

  const visible: T[] = [];
  const hidden = emptyCounts();
  let hiddenTotal = 0;
  for (let i = 0; i < tasks.length; i++) {
    if (kept.has(i)) visible.push(tasks[i]);
    else { hiddenTotal++; bump(hidden, tasks[i].status); }
  }
  return { visible, hiddenTotal, hidden };
}

/**
 * Format the collapse summary line: `+N more (x done, y running)`.
 * Only non-zero buckets are listed, in done/running/pending/interrupted
 * order. Returns null when nothing is hidden.
 */
export function formatCollapseSummary(hidden: CollapseCounts): string | null {
  const total = hidden.done + hidden.running + hidden.pending + hidden.failed + hidden.aborted;
  if (total <= 0) return null;
  const parts: string[] = [];
  if (hidden.done > 0) parts.push(`${hidden.done} done`);
  if (hidden.running > 0) parts.push(`${hidden.running} running`);
  if (hidden.pending > 0) parts.push(`${hidden.pending} pending`);
  const interrupted = hidden.failed + hidden.aborted;
  if (interrupted > 0) parts.push(`${interrupted} interrupted`);
  return parts.length > 0 ? `+${total} more (${parts.join(", ")})` : `+${total} more`;
}

// ── Key routing ───────────────────────────────────────────────
// Pure key → action routers. The `match` function is injected by the
// host component (pi-tui matchesKey + KeybindingsManager) or by tests
// (a plain lookup table), so routing logic is testable without pi-tui.

export type KeyMatchFn = (data: string, keyId: string) => boolean;

export type BrowserKeyAction =
  | "cancel"
  | "moveUp"
  | "moveDown"
  | "toggleFilter"
  | "refresh"
  | "requestStop"
  | "openOutput"
  | "confirmStop"
  | "dismissStop"
  | "ignore";

/**
 * Route a keystroke in the main browser view. When a stop confirmation
 * is pending, y/Y confirms and EVERY other key dismisses (existing
 * behavior). Named keybindings (tui.select.*) come first so user
 * keybinding overrides win; vim-style letters are kept as aliases.
 */
export function routeBrowserKey(
  data: string,
  pendingStop: boolean,
  match: KeyMatchFn,
): BrowserKeyAction {
  if (pendingStop) {
    if (match(data, "y") || match(data, "shift+y")) return "confirmStop";
    return "dismissStop";
  }
  if (match(data, "tui.select.cancel") || match(data, "q") || match(data, "shift+q")) return "cancel";
  if (match(data, "tui.select.up") || match(data, "k")) return "moveUp";
  if (match(data, "tui.select.down") || match(data, "j")) return "moveDown";
  if (match(data, "tab")) return "toggleFilter";
  if (match(data, "r") || match(data, "shift+r")) return "refresh";
  if (match(data, "s") || match(data, "shift+s")) return "requestStop";
  if (match(data, "o") || match(data, "shift+o") || match(data, "tui.select.confirm")) return "openOutput";
  return "ignore";
}

export type ViewerKeyAction =
  | "close"
  | "scrollUp"
  | "scrollDown"
  | "pageUp"
  | "pageDown"
  | "top"
  | "bottom"
  | "ignore";

/** Route a keystroke in the full-screen output viewer. */
export function routeViewerKey(data: string, match: KeyMatchFn): ViewerKeyAction {
  if (match(data, "tui.select.cancel") || match(data, "q") || match(data, "shift+q")) return "close";
  if (match(data, "tui.select.up") || match(data, "k")) return "scrollUp";
  if (match(data, "tui.select.down") || match(data, "j")) return "scrollDown";
  if (match(data, "u") || match(data, "tui.select.pageUp")) return "pageUp";
  if (match(data, "d") || match(data, "tui.select.pageDown")) return "pageDown";
  if (match(data, "g") || match(data, "home")) return "top";
  if (match(data, "shift+g") || match(data, "end")) return "bottom";
  return "ignore";
}
