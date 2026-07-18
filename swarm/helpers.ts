// ============================================================
// Swarm Mode — Utility Helpers
// ============================================================

import { GridLayout, AgentStatus } from "./types";
import {
  BRAILLE_LEVELS,
  BRAILLE_BAR_FILLED,
  BRAILLE_EMPTY,
  BRAILLE_BAR_MAX_WIDTH,
  BRAILLE_BAR_MIN_WIDTH,
  MIN_LABEL_WIDTH,
  CELL_GAP,
  TEXT_CELL_PREFERRED_WIDTH,
  COMPLETE_FILL_MS,
} from "./types";

// ============================================================
// Braille Bar — Real progress based on tool call count
// ============================================================

/**
 * Completed fill animation: smoothly fills remaining bar over COMPLETE_FILL_MS.
 */
export function completedDisplayTicks(progress: number, width: number, phaseElapsedMs: number): number {
  if (progress >= 1) return width * BRAILLE_LEVELS.length;
  const baseTicks = Math.floor(progress * width * BRAILLE_LEVELS.length);
  const fullBarTicks = width * BRAILLE_LEVELS.length;
  const fillProgress = Math.max(0, Math.min(1, phaseElapsedMs / COMPLETE_FILL_MS));
  return Math.min(fullBarTicks, Math.ceil(baseTicks + (fullBarTicks - baseTicks) * fillProgress));
}

/**
 * Renders a braille progress bar based on real progress (0~1).
 * Replaces the fake tick-driven animation with real tool call progress.
 */
export function accumulatedBrailleBar(
  progress: number,
  width: number,
  phase: AgentStatus,
  completedAtMs?: number,
  nowMs?: number,
): string {
  const innerWidth = Math.max(1, width);
  const dotsPerCell = BRAILLE_LEVELS.length;

  // For completed/failed tasks, do the fill animation
  let displayProgress = progress;
  if ((phase === "done" || phase === "failed") && completedAtMs !== undefined) {
    const elapsed = Math.max(0, (nowMs ?? Date.now()) - completedAtMs);
    displayProgress = Math.min(1, progress + (1 - progress) * Math.min(1, elapsed / COMPLETE_FILL_MS));
  }

  displayProgress = Math.max(0, Math.min(1, displayProgress));
  const totalDots = Math.round(displayProgress * innerWidth * dotsPerCell);

  const cells: string[] = [];
  for (let i = 0; i < innerWidth; i++) {
    const cellStart = i * dotsPerCell;
    const filledDots = Math.max(0, Math.min(dotsPerCell, totalDots - cellStart));
    if (filledDots >= dotsPerCell) {
      cells.push(BRAILLE_BAR_FILLED);
    } else if (filledDots > 0) {
      cells.push(BRAILLE_LEVELS[filledDots - 1]);
    } else {
      cells.push(BRAILLE_EMPTY);
    }
  }
  return "[" + cells.join("") + "]";
}

/**
 * Compute progress for a task based on real tool call counts.
 */
export function computeProgress(task: { toolCalls: number; estimatedTotalCalls: number; status: string }): number {
  if (task.status === "done" || task.status === "failed") return 1;
  if (task.estimatedTotalCalls <= 0) return 0;
  return Math.min(1, task.toolCalls / task.estimatedTotalCalls);
}

/**
 * Check if any task still needs animation frames (completed fill).
 */
export function needsAnimation(tasks: { status: string; completedAtMs?: number }[], nowMs: number): boolean {
  for (const t of tasks) {
    if (t.status === "done" || t.status === "failed") {
      if (t.completedAtMs !== undefined && nowMs - t.completedAtMs < COMPLETE_FILL_MS) return true;
    }
  }
  return false;
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

export const AGENT_SWARM_TITLE_ACCENT_BIAS = 1.3;

/**
 * Kimi Code-style gradient text: interpolates between two hex colors per character.
 * Uses raw ANSI 24-bit color codes since Pi's theme doesn't support hex colors.
 */
export function gradientText(
  text: string,
  fromHex: string,
  toHex: string,
  accentBias = 1,
): string {
  const chars = Array.from(text);
  if (chars.length <= 1) return text;

  function parseHex(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16) } : null;
  }

  const from = parseHex(fromHex);
  const to = parseHex(toHex);
  if (!from || !to) return text;

  const bias = isFinite(accentBias) ? Math.max(0, accentBias) : 1;

  return chars.map((char, i) => {
    const ratio = Math.min(1, (i / (chars.length - 1)) * bias);
    const r = Math.round(from.r + (to.r - from.r) * ratio);
    const g = Math.round(from.g + (to.g - from.g) * ratio);
    const blue = Math.round(from.b + (to.b - from.b) * ratio);
    return `\x1b[38;2;${r};${g};${blue}m${char}\x1b[0m`;
  }).join('');
}
