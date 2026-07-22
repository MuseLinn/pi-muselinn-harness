// ============================================================
// TUI — spinner keep-alive gate (pure, no pi imports).
//
// pi-tui re-renders the WHOLE component tree per frame, which at high
// context costs real milliseconds. The border spinner animation rides on
// pi's natural renders (wall-clock frame selection in the slot builder);
// the keep-alive timer exists solely to cover quiet gaps (long tool
// executions with no streaming). This predicate is the gate: only force a
// render when the agent is working AND pi has been quiet for a while.
// ============================================================

/** Minimum quiet period before a keep-alive render is forced (ms). */
export const KEEP_ALIVE_QUIET_MS = 400;

export function shouldKeepAliveRender(working: boolean, lastRenderAt: number, now: number): boolean {
  return working && now - lastRenderAt >= KEEP_ALIVE_QUIET_MS;
}

/** Wall-clock spinner frame index: advances on any render, no state. */
export function wallClockFrameIndex(frameCount: number, now: number, frameIntervalMs: number): number {
  if (frameCount <= 0) return 0;
  return Math.floor(now / frameIntervalMs) % frameCount;
}
