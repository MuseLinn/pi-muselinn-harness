// ============================================================
// Renderer — frame loop with coalesced requestRender (16ms cap).
//
// Semantics mirror pi-tui's renderRequested flag + MIN_RENDER_INTERVAL,
// but the render unit is the diffed frame from the component stack:
// first frame writes everything (clear + full paint), later frames
// write only the diff ops. A frame with zero diff ops writes nothing.
// ============================================================

import { diffFrames, opsToAnsi, type RenderOp } from "./buffer.ts";
import type { ComponentStack } from "./tree.ts";

export interface TerminalWriter {
  write(s: string): void;
}

/** Test writer: captures everything written. */
export class StringWriter implements TerminalWriter {
  chunks: string[] = [];
  write(s: string): void {
    this.chunks.push(s);
  }
  get text(): string {
    return this.chunks.join("");
  }
}

export interface RendererOptions {
  /** Min interval between frames (pi-tui parity: 16ms). */
  intervalMs?: number;
  /** Total rows of the terminal (for shrink clears). */
  rows?: number;
  /** Terminal width provider. */
  width: () => number;
}

export class Renderer {
  private readonly stack: ComponentStack;
  private readonly writer: TerminalWriter;
  private readonly intervalMs: number;
  private readonly widthFn: () => number;

  private previousLines: string[] = [];
  private hasRendered = false;
  private renderRequested = false;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private lastRenderAt = 0;
  private stopped = false;

  constructor(stack: ComponentStack, writer: TerminalWriter, options: RendererOptions) {
    this.stack = stack;
    this.writer = writer;
    this.intervalMs = options.intervalMs ?? 16;
    this.widthFn = options.width;
  }

  /** Coalesced render request: bursts collapse into one frame. */
  requestRender(): void {
    if (this.stopped || this.renderRequested) return;
    this.renderRequested = true;
    this.schedule();
  }

  /** Force a full repaint (width change, fullscreen swap). */
  requestFullRender(): void {
    this.previousLines = [];
    this.hasRendered = false;
    this.stack.invalidate();
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
    this.renderRequested = false;
    this.doRender();
  }

  private schedule(): void {
    if (this.renderTimer) return;
    const elapsed = performance.now() - this.lastRenderAt;
    const delay = Math.max(0, this.intervalMs - elapsed);
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      if (this.stopped || !this.renderRequested) return;
      this.renderRequested = false;
      this.lastRenderAt = performance.now();
      this.doRender();
      if (this.renderRequested) this.schedule();
    }, delay);
    this.renderTimer.unref?.();
  }

  /** Render one frame synchronously (first frame or forced). */
  private doRender(): void {
    const width = Math.max(1, this.widthFn());
    const lines = this.stack.render(width);

    if (!this.hasRendered) {
      // First frame: clear screen, home, paint everything.
      let out = "\x1b[2J\x1b[H";
      for (let i = 0; i < lines.length; i++) {
        if (i > 0) out += "\r\n";
        out += lines[i] + "\x1b[K";
      }
      this.writer.write(out);
      this.previousLines = lines;
      this.hasRendered = true;
      return;
    }

    const ops = diffFrames(this.previousLines, lines);
    if (ops.length === 0) return; // settled frame — zero terminal writes
    const { ansi } = opsToAnsi(ops, this.previousLines.length);
    this.writer.write(ansi);
    this.previousLines = lines;
  }

  stop(): void {
    this.stopped = true;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
  }
}
