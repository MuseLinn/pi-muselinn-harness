// ============================================================
// Swarm Mode — TUI Widget (Kimi Code-style braille grid)
// Renders through the pi-tui Component protocol (SwarmWidgetComponent,
// same Container-based pattern as TasksBrowserComponent); the refresh
// timer ticks at FRAME_INTERVAL_MS and is fingerprint-gated.
//
// The pure line builders live in core (packages/core/swarm/widget-lines.ts)
// and are re-exported here for back-compat.
// ============================================================

import { Container, truncateToWidth } from "@earendil-works/pi-tui";
import type { SwarmState } from "../packages/core/swarm/types";
import { computeWidgetFingerprint, buildWidgetLines } from "../packages/core/swarm/widget-lines";

export {
  buildGoalStatus,
  buildWidgetLines,
  colorBar,
  cellLabel,
  buildStatusLine,
  computeWidgetFingerprint,
} from "../packages/core/swarm/widget-lines";

// ============================================================
// SwarmWidgetComponent — pi-tui Component wrapping the swarm widget
// ============================================================

export type SwarmWidgetUpdate = "changed" | "unchanged" | "empty";

/**
 * pi-tui Component for the swarm progress widget, using the same
 * Container-based architecture as TasksBrowserComponent so both surfaces
 * share one Component protocol (`render(width): string[]` + `invalidate()`).
 *
 * The widget is registered through ctx.ui.setWidget(key, factory); pi mounts
 * the returned component in a Container whose render(width) is invoked by the
 * TUI root with the full terminal width. Lines are still hand-built ANSI
 * (theme.fg / gradientText / braille grid) — pi-tui's Text component would
 * word-wrap long lines and pad to full width, which breaks the braille grid
 * on narrow terminals, so render() only truncates to the viewport width.
 *
 * Time-purity: render() never reads the clock. Visible line content is
 * rebuilt only by update() (fingerprint-gated, driven by the refresh timer
 * and progress callbacks) or by a viewport width change, and width-change
 * rebuilds reuse the timestamp of the last update. Once the swarm settles
 * (refreshIntervalMs === 0) and the timer stops, re-renders triggered by
 * unrelated UI activity repaint the cached frame verbatim — the
 * spinner / fill animation stay frozen on their last frame.
 */
export class SwarmWidgetComponent extends Container {
  private readonly getState: () => SwarmState | null;
  private readonly theme: any;
  private readonly isCancelPending: () => boolean;

  private lines: string[] = [];
  /** Last viewport width seen by render(); 0 = never rendered. */
  private renderWidth = 0;
  /** Timestamp of the last update() that produced the cached lines. */
  private lastBuildMs = 0;
  private lastFingerprint: string | null = null;
  /** Refresh cadence from the last build; 0 = animation settled. */
  refreshIntervalMs = 0;

  constructor(
    getState: () => SwarmState | null,
    theme: any,
    isCancelPending: () => boolean,
  ) {
    super();
    this.getState = getState;
    this.theme = theme;
    this.isCancelPending = isCancelPending;
  }

  /** Width used for layout before the first render() delivers the real one. */
  private effectiveWidth(): number {
    return this.renderWidth > 0 ? this.renderWidth : (process?.stdout?.columns ?? 100);
  }

  /**
   * Fingerprint-gated rebuild. Called by the refresh timer and by subagent
   * progress callbacks. Returns "changed" when the visible lines were
   * rebuilt, "unchanged" when the fingerprint matched the cached frame, and
   * "empty" when there is nothing to display (no active swarm state).
   */
  update(nowMs?: number): SwarmWidgetUpdate {
    const ts = nowMs ?? Date.now();
    const width = this.effectiveWidth();
    const state = this.getState();
    const fp = computeWidgetFingerprint(state, this.isCancelPending(), ts, width);
    if (fp !== null && fp === this.lastFingerprint) return "unchanged";
    const result = buildWidgetLines(state, this.theme, this.isCancelPending(), ts, width);
    if (!result || result.lines.length === 0) return "empty";
    this.lastFingerprint = fp;
    this.lastBuildMs = ts;
    this.lines = result.lines;
    this.refreshIntervalMs = result.refreshInterval;
    return "changed";
  }

  override render(width: number): string[] {
    if (width > 0 && width !== this.renderWidth) {
      this.renderWidth = width;
      if (this.lines.length > 0) {
        // Rebuild the layout for the new width with the ORIGINAL build
        // timestamp so time-driven frames (spinner, fill animation)
        // stay frozen between updates.
        const state = this.getState();
        const result = buildWidgetLines(state, this.theme, this.isCancelPending(), this.lastBuildMs, width);
        if (result && result.lines.length > 0) {
          this.lines = result.lines;
          this.refreshIntervalMs = result.refreshInterval;
          this.lastFingerprint = computeWidgetFingerprint(state, this.isCancelPending(), this.lastBuildMs, width);
        }
      }
    }
    // Final safety: never emit a line wider than the viewport.
    return this.lines.map((l) => truncateToWidth(l, width));
  }
}
