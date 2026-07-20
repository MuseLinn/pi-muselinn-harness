// ============================================================
// Text utilities (pure, no host imports) — shared by core modules
// that measure or cut terminal text (swarm grid, tui box borders).
// ============================================================

/**
 * Visible terminal width of a string: SGR escape sequences count as 0,
 * CJK ideographs and CJK punctuation count as 2 columns, everything
 * else as 1. Matches the layout math used across the swarm grid and
 * the boxed editor borders.
 */
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
