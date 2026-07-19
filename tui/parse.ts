// ============================================================
// TUI — /tui argument parsing (pure, no pi imports).
//
//   /tui                            → status
//   /tui style <plain|boxed|compact>  → editor chrome
//   /tui timing                     → render timing stats (env-gated)
// ============================================================

import { EDITOR_STYLES, type EditorStyle } from "./box";

export type TuiCommand =
  | { kind: "status" }
  | { kind: "style"; style: EditorStyle }
  | { kind: "timing" }
  | { kind: "error"; message: string };

export function parseTuiArgs(args: string): TuiCommand {
  const tokens = (args || "").trim().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return { kind: "status" };

  const sub = tokens[0].toLowerCase();
  if (sub === "style") {
    const style = (tokens[1] || "").toLowerCase();
    if ((EDITOR_STYLES as readonly string[]).includes(style)) {
      return { kind: "style", style: style as EditorStyle };
    }
    return { kind: "error", message: `Usage: /tui style <${EDITOR_STYLES.join("|")}>` };
  }
  if (sub === "timing") {
    return { kind: "timing" };
  }
  if (sub === "status") {
    return { kind: "status" };
  }
  return {
    kind: "error",
    message: "Usage: /tui style <plain|boxed|compact> | /tui timing",
  };
}
