// ============================================================
// Shell output sanitizer (pure, no host imports).
//
// Ported from Kimi Code's apps/kimi-code/src/tui/utils/shell-output.ts:
// captured command output can contain terminal control sequences — colours,
// cursor moves, alternate-screen switches, hyperlinks, `\r` spinners, bells.
// Rendered raw, the terminal executes them and fights the TUI's own cursor
// control ("blank screen + leftover characters"). Strip everything a terminal
// would interpret as a command, keeping only `\n` and `\t`.
//
// Upstream sync: verified with MoonshotAI/kimi-code main @ c5b6103b.
// ============================================================

// ESC [ <params> <intermediates> <final> — colours, cursor moves, clear, and
// private modes such as ESC[?1049h (alt screen) / ESC[?25l (hide cursor).
const CSI_PATTERN = /\x1b\[[0-9:;<=>?]*[ -/]*[@-~]/g;
// ESC ] … <BEL>  or  ESC ] … ESC \ — window titles and OSC 8 hyperlinks.
const OSC_PATTERN = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;
// ESC <char> (and ESC <intermediate> <char>) — charset/keypad selection,
// save/restore cursor (ESC 7 / ESC 8), full reset (ESC c), etc. Runs after the
// CSI/OSC patterns, so it only catches sequences they didn't already consume.
const ESC_SINGLE_PATTERN = /\x1b(?:[ -/][0-~]|[0-~])/g;
// C0 control characters except \n (0x0A) and \t (0x09): NUL, BEL, \b, \r, …
// plus a lone ESC (0x1B) that wasn't part of a sequence recognised above.
const C0_CONTROL_PATTERN = /[\x00-\x08\x0b-\x1b\x1c-\x1f]/g;

/**
 * Strip every terminal control sequence from captured command output so it is
 * safe to store, render, and feed back to the model.
 *
 * Never throws: a bad or pathological input falls back to stripping only the
 * C0 control characters.
 */
export function sanitizeShellOutput(text: string): string {
  if (typeof text !== "string") return "";
  if (text.length === 0) return text;
  try {
    return text
      .replace(OSC_PATTERN, "")
      .replace(CSI_PATTERN, "")
      .replace(ESC_SINGLE_PATTERN, "")
      .replace(C0_CONTROL_PATTERN, "");
  } catch {
    return text.replace(C0_CONTROL_PATTERN, "");
  }
}
