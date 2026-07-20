// ============================================================
// Renderer — virtual line buffer + frame diff (pure, host-agnostic).
//
// The core of MusePi's incremental renderer: components emit string[]
// frames (core's line-builders already do), the buffer diffs
// consecutive frames, and only the changed rows are written to the
// terminal. pi-tui re-renders its whole component tree per frame; here
// a settled frame costs zero terminal writes.
// ============================================================

/** One terminal mutation, in application order. */
export type RenderOp =
  /** Move the hardware cursor to this absolute row (0-based from the frame origin). */
  | { type: "moveTo"; row: number }
  /** Write text at the cursor and clear to end of line. */
  | { type: "write"; text: string }
  /** Erase from the cursor to the end of the screen (frame shrink). */
  | { type: "clearToEnd" };

/**
 * Diff two frames line-by-line: skip the identical prefix, rewrite the
 * changed tail, clear leftover rows when the frame shrank. Rows are
 * compared as raw strings (callers truncate to width upstream).
 *
 * This is deliberately prefix-only — suffix trimming pays nothing once
 * the cursor has to walk to the first changed row anyway.
 */
export function diffFrames(prev: readonly string[], next: readonly string[]): RenderOp[] {
  let start = 0;
  const shared = Math.min(prev.length, next.length);
  while (start < shared && prev[start] === next[start]) start++;

  const ops: RenderOp[] = [];
  if (start >= next.length && prev.length <= next.length) return ops; // identical

  if (start < next.length) {
    ops.push({ type: "moveTo", row: start });
    for (let i = start; i < next.length; i++) {
      ops.push({ type: "write", text: next[i] });
    }
  } else {
    // Frame shrank with no content change: just move to the new end.
    ops.push({ type: "moveTo", row: next.length });
  }
  if (prev.length > next.length) {
    ops.push({ type: "clearToEnd" });
  }
  return ops;
}

/** ANSI encoding of an op stream, given the cursor's current row. */
export function opsToAnsi(ops: readonly RenderOp[], currentRow: number): { ansi: string; endRow: number } {
  let out = "";
  let row = currentRow;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.type === "moveTo") {
      const delta = op.row - row;
      if (delta > 0) out += `\x1b[${delta}B`;
      else if (delta < 0) out += `\x1b[${-delta}A`;
      out += "\r";
      row = op.row;
    } else if (op.type === "write") {
      out += op.text + "\x1b[K";
      // Consecutive writes are consecutive rows (diffFrames emits runs).
      if (ops[i + 1]?.type === "write") out += "\r\n";
      row += 1;
    } else {
      out += "\x1b[J";
    }
  }
  return { ansi: out, endRow: row };
}
