// ============================================================
// TUI — Box drawing primitives (pure, no pi imports).
//
// wrapWithSideBorders is ported from Kimi Code's
// apps/kimi-code/src/tui/components/editor/custom-editor.ts: pi-tui only
// renders horizontal top/bottom borders; we wrap them with ╭╮╰╯ corners
// and add vertical │ bars on each row's outer columns. The `topBorder`
// option (our addition) replaces the first dash row outright, so the
// boxed editor can embed spinner/model info into ╭─ … ─╮ instead of a
// plain corner-wrapped dash run.
//
// Upstream sync: verified current with MoonshotAI/kimi-code main @
// c5b6103b (2026-07-20); the ported region is unaffected by upstream
// changes through that commit. Re-check with:
//   git log --oneline c5b6103b..origin/main -- \
//     apps/kimi-code/src/tui/components/editor/custom-editor.ts
// ============================================================

import { visibleWidth } from "../text-utils";

/** Strip SGR (color/style) escape sequences — the subset pi-tui emits. */
export function stripSgr(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export type EditorStyle = "plain" | "boxed" | "compact";

export const EDITOR_STYLES: readonly EditorStyle[] = ["plain", "boxed", "compact"];

export interface WrapOptions {
  /** Top border connects to a box above (├┤ instead of ╭╮). */
  readonly connectedAbove?: boolean;
  /** Overlaid on the left of the top border (plain dash runs only). */
  readonly label?: string;
  /** Full replacement for the first dash row (already cornered). */
  readonly topBorder?: string;
}

/**
 * Post-process pi-tui's editor output to draw a full box around it.
 *
 * Horizontal-border rows (first visible char `─`, including scroll
 * indicators like `── ↑ N more ──`) are stripped of their existing SGR
 * and repainted as a single box-drawn span. Content rows keep their
 * inner SGR intact; only column 0 and the last column are overlaid, and
 * only if they're literal spaces — that protects the cursor-overflow
 * case where the rightmost column is an SGR-tagged inverse cursor.
 */
export function wrapWithSideBorders(
  lines: string[],
  paint: (s: string) => string,
  options: WrapOptions = {},
): string[] {
  let seenTop = false;
  return lines.map((line) => {
    const plain = stripSgr(line);
    if (plain.length > 0 && plain[0] === "─") {
      const isTop = !seenTop;
      seenTop = true;
      if (isTop && options.topBorder !== undefined) return options.topBorder;
      const leftCorner = isTop ? (options.connectedAbove === true ? "├" : "╭") : "╰";
      const rightCorner = isTop ? (options.connectedAbove === true ? "┤" : "╮") : "╯";
      if (plain.length === 1) return paint(leftCorner);
      const middle = plain.slice(1, -1);
      if (isTop && options.label !== undefined && /^─+$/.test(middle)) {
        const labelWidth = visibleWidth(options.label);
        if (labelWidth <= middle.length) {
          return (
            paint(leftCorner) +
            options.label +
            paint("─".repeat(middle.length - labelWidth)) +
            paint(rightCorner)
          );
        }
      }
      return paint(leftCorner + middle + rightCorner);
    }
    if (line.length === 0) return line;
    const firstCh = line[0];
    const lastCh = line[line.length - 1];
    const head = firstCh === " " ? paint("│") : firstCh ?? "";
    const tail = line.length > 1 && lastCh === " " ? paint("│") : lastCh ?? "";
    if (line.length === 1) return head;
    return head + line.slice(1, -1) + tail;
  });
}

/**
 * Truncate a (possibly SGR-tagged) string to a visible-width budget,
 * appending "…" when cut. SGR sequences pass through uncounted; the cut
 * is made on visible characters only. Simple char-walk — adequate for
 * the short single-line labels used on the editor border.
 */
export function truncateVisible(s: string, maxWidth: number): string {
  if (visibleWidth(s) <= maxWidth) return s;
  if (maxWidth <= 1) return "…".slice(0, Math.max(0, maxWidth));
  const budget = maxWidth - 1; // reserve for …
  let out = "";
  let w = 0;
  let inEscape = false;
  let sawEscape = false;
  for (const ch of s) {
    if (ch === "\x1b") { inEscape = true; sawEscape = true; out += ch; continue; }
    if (inEscape) { out += ch; if (ch === "m") inEscape = false; continue; }
    const cw = visibleWidth(ch);
    if (w + cw > budget) break;
    out += ch;
    w += cw;
  }
  // Close any open SGR before the ellipsis so it can't leak color.
  return out + (sawEscape ? "\x1b[0m…" : "…");
}

/**
 * Compose the editor's top border line with left/right slots embedded.
 *
 * Layout: `╭ left ──── right ╮` (corners) or `─ left ──── right ─`
 * (compact, no corners). The dash run shrinks to fit; when the slots
 * overflow, the left slot is truncated first (the right slot carries the
 * model identity, the left only transient spinner/status text).
 * `paint` colors the border dashes/corners; slots arrive pre-styled.
 */
export function composeTopBorder(
  width: number,
  left: string,
  right: string,
  paint: (s: string) => string,
  corners: boolean,
): string {
  const inner = corners ? width - 2 : width;
  const body = layoutBorderLine(Math.max(0, inner), left, right, paint);
  return corners ? paint("╭") + body + paint("╮") : body;
}

function layoutBorderLine(
  w: number,
  left: string,
  right: string,
  paint: (s: string) => string,
): string {
  const dash = (n: number) => paint("─".repeat(Math.max(0, n)));
  const lw = visibleWidth(left);
  const rw = visibleWidth(right);

  // Slots get a separating dash outside and space padding inside:
  // `─ left ── right ─` → each present slot costs its width + 3.
  const leftCost = lw > 0 ? lw + 3 : 0;
  const rightCost = rw > 0 ? rw + 3 : 0;

  if (leftCost + rightCost + 1 <= w) {
    const fill = w - leftCost - rightCost;
    return (
      (lw > 0 ? dash(1) + " " + left + " " : "") +
      dash(fill) +
      (rw > 0 ? " " + right + " " + dash(1) : "")
    );
  }

  // Overflow: truncate the left slot first, then the right.
  const rightBudget = Math.max(0, Math.min(rw, w - 4));
  const rightPart = rightBudget > 0 ? " " + truncateVisible(right, rightBudget) + " " : "";
  const leftBudget = Math.max(0, w - visibleWidth(rightPart) - 4);
  const leftPart = leftBudget > 0 ? dash(1) + " " + truncateVisible(left, leftBudget) + " " : "";
  const used = visibleWidth(leftPart) + visibleWidth(rightPart);
  return leftPart + dash(w - used) + rightPart;
}
