// ============================================================
// TUI — Style switch planning (pure, no pi imports).
//
// The decision layer of runtime style switching, separated from the pi
// calls so the round-trip restore contract is unit-testable:
//   style plain  → unregister the custom editor (pi restores default)
//                  + show pi's working indicator again
//   style boxed/compact → register a factory + hide the indicator
// ============================================================

import type { EditorStyle } from "./box.ts";

export interface StylePlan {
  /** true → register a MuselinnEditor factory; false → setEditorComponent(undefined). */
  registerFactory: boolean;
  /** pi's own working indicator visibility for this style. */
  workingVisible: boolean;
}

export function planStyleSwitch(style: EditorStyle): StylePlan {
  return style === "plain"
    ? { registerFactory: false, workingVisible: true }
    : { registerFactory: true, workingVisible: false };
}
