// ============================================================
// Swarm Mode — Utility Helpers
// ============================================================

import { SubAgentTask, GridLayout, AgentStatus } from "./types";
import {
  BRAILLE_LEVELS,
  BRAILLE_BAR_FILLED,
  BRAILLE_EMPTY,
  BRAILLE_RIGHT_COLUMN_FULL,
  BRAILLE_BAR_MAX_WIDTH,
  BRAILLE_BAR_MIN_WIDTH,
  MIN_LABEL_WIDTH,
  CELL_GAP,
  TEXT_CELL_PREFERRED_WIDTH,
  COMPLETE_FILL_MS,
} from "./types";

// ============================================================
// Braille Bar — Kimi Code tick-driven accumulated render
// ============================================================

/**
 * Completed fill animation: smoothly fills remaining bar over COMPLETE_FILL_MS.
 * Returns the display ticks for rendering.
 */
export function completedDisplayTicks(ticks: number, width: number, phaseElapsedMs: number): number {
  const fullBarTicks = width * BRAILLE_LEVELS.length;
  if (ticks >= fullBarTicks) return fullBarTicks;
  const fillProgress = Math.max(0, Math.min(1, phaseElapsedMs / COMPLETE_FILL_MS));
  return Math.min(fullBarTicks, Math.ceil(ticks + (fullBarTicks - ticks) * fillProgress));
}

/**
 * Like Kimi Code's `accumulatedBrailleBar()`:
 * Renders a braille progress bar driven by a cumulative tick counter.
 * Each cycle (width × braille levels) fills all cells, then resets.
 * `completedCycles` > 0 shows a separator `⢸` at the boundary.
 */
export function accumulatedBrailleBar(
  ticks: number,
  width: number,
  phase: AgentStatus,
): string {
  const innerWidth = Math.max(1, width);
  const dotsPerCell = BRAILLE_LEVELS.length;
  const cycleSize = innerWidth * dotsPerCell;
  const safeTicks = Math.max(0, Math.ceil(ticks));
  const completedCycles = Math.floor(safeTicks / cycleSize);
  const cycleTicks = safeTicks % cycleSize;
  const activeCells = cycleTicks === 0 ? 0 : Math.ceil(cycleTicks / dotsPerCell);
  const separatorIndex =
    completedCycles > 0 && activeCells > 0 && activeCells < innerWidth
      ? activeCells
      : -1;

  const cells: string[] = [];
  for (let i = 0; i < innerWidth; i++) {
    if (i === separatorIndex) {
      cells.push(BRAILLE_RIGHT_COLUMN_FULL);
      continue;
    }
    if (i < activeCells) {
      // Last active cell may be partially filled
      const cellStart = i * dotsPerCell;
      const filledDots = Math.max(0, cycleTicks - cellStart);
      if (filledDots >= dotsPerCell) {
        cells.push(BRAILLE_BAR_FILLED);
      } else if (filledDots > 0) {
        cells.push(BRAILLE_LEVELS[filledDots - 1]);
      } else {
        cells.push(BRAILLE_EMPTY);
      }
    } else {
      cells.push(BRAILLE_EMPTY);
    }
  }
  return "[" + cells.join("") + "]";
}

/**
 * Determine display ticks for a task based on its phase and timing.
 */
export function computeDisplayTicks(
  task: SubAgentTask,
  nowMs: number,
): number {
  const baseTicks = task.ticks;
  if (task.status === "done" && task.completedAtMs !== undefined) {
    const elapsed = Math.max(0, nowMs - task.completedAtMs);
    return completedDisplayTicks(baseTicks, BRAILLE_BAR_MAX_WIDTH, elapsed);
  }
  if (task.status === "failed" && task.completedAtMs !== undefined) {
    const elapsed = Math.max(0, nowMs - task.completedAtMs);
    return completedDisplayTicks(Math.max(1, baseTicks), BRAILLE_BAR_MAX_WIDTH, elapsed);
  }
  if (task.status === "aborted") return baseTicks;
  return baseTicks;
}

/**
 * Check if a task still needs animation frames
 */
export function needsAnimation(task: SubAgentTask, nowMs: number): boolean {
  if (task.status === "running") return true;
  if (task.status === "pending") return true;
  if (task.status === "aborted") return false;
  if (task.completedAtMs !== undefined) {
    return nowMs - task.completedAtMs < COMPLETE_FILL_MS;
  }
  return false;
}

/**
 * Increment ticks for all running/pending tasks once per frame.
 */
export function incrementTicks(tasks: SubAgentTask[], nowMs: number): boolean {
  let hasAnimation = false;
  for (const t of tasks) {
    if (t.status === "running" || t.status === "pending") {
      t.ticks++;
      hasAnimation = true;
    } else if (t.status === "done" || t.status === "failed") {
      if (t.completedAtMs !== undefined && nowMs - t.completedAtMs < COMPLETE_FILL_MS) {
        hasAnimation = true;
      }
    }
  }
  return hasAnimation;
}

// ============================================================
// Grid Layout Calculator (Kimi Code-style adaptive)
// ============================================================

export function calculateGridLayout(count: number, availableWidth: number, availableHeight: number): GridLayout {
  if (count <= 0) return { columns: 1, rows: 0, cellWidth: 0, barCells: 1 };

  const gapWidth = visibleWidth(CELL_GAP);

  // Try text mode first — enough width per cell?
  const idWidth = Math.max(3, String(count).length);
  const minCellWidth = idWidth + 1 + BRAILLE_BAR_MAX_WIDTH + 2 + MIN_LABEL_WIDTH + 2;
  const cols = Math.max(1, Math.min(count, Math.floor((availableWidth + gapWidth) / (Math.max(1, minCellWidth) + gapWidth))));
  const rows = Math.ceil(count / cols);

  // If text mode fits, use it
  if (rows <= Math.max(1, availableHeight)) {
    const cellWidth = Math.floor((availableWidth - gapWidth * Math.max(0, cols - 1)) / cols);
    const barCells = Math.max(BRAILLE_BAR_MIN_WIDTH, Math.min(BRAILLE_BAR_MAX_WIDTH, cellWidth - idWidth - MIN_LABEL_WIDTH - 6));
    return { columns: cols, rows, cellWidth, barCells };
  }

  // Compact mode: more rows, smaller cells
  const compactCols = Math.max(1, Math.min(count, Math.ceil(count / Math.max(1, availableHeight))));
  const compactRows = Math.ceil(count / compactCols);
  const compactCellWidth = Math.floor((availableWidth - gapWidth * Math.max(0, compactCols - 1)) / compactCols);
  const compactBarCells = Math.max(1, compactCellWidth - idWidth - 5);
  return { columns: compactCols, rows: compactRows, cellWidth: compactCellWidth, barCells: compactBarCells };
}

export function visibleWidth(s: string): number {
  let w = 0;
  let inEscape = false;
  for (const ch of s) {
    if (ch === "\x1b") { inEscape = true; continue; }
    if (inEscape) { if (ch === "m") inEscape = false; continue; }
    const cp = ch.charCodeAt(0);
    if (cp >= 0x4e00 && cp <= 0x9fff) w += 2;
    else if (cp >= 0x3000 && cp <= 0x303f) w += 2;
    else w += 1;
  }
  return w;
}

// ============================================================
// Formatting helpers
// ============================================================

export function fmtTokens(n: number): string {
  return n < 1000 ? `${n}` : n < 10000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n / 1000)}k`;
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function fmtCost(c: number): string {
  if (c === 0) return "$0";
  if (c < 0.01) return `$${c.toFixed(4)}`;
  return `$${c.toFixed(2)}`;
}
