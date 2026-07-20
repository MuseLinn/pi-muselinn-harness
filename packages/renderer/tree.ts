// ============================================================
// Renderer — retained component tree with per-node damage tracking.
//
// Components emit string[] per frame. The stack caches each child's
// last fingerprint + width + lines and skips the child's render() call
// entirely when nothing it depends on changed — damage tracking at the
// node level, so a 1-char spinner tick in one widget never re-renders
// the chat history component.
// ============================================================

/** The component protocol (mirrors pi-tui's render(width) contract). */
export interface Renderable {
  render(width: number): string[];
  /** Optional cheap state fingerprint for frame-level damage tracking. */
  fingerprint?(): unknown;
  /** Optional hook: external state changed, drop cached output. */
  invalidate?(): void;
}

interface CacheEntry {
  fingerprint: unknown;
  hasFingerprint: boolean;
  width: number;
  lines: string[];
  rendered: boolean;
}

/** A vertical stack of renderables with per-node output caching. */
export class ComponentStack implements Renderable {
  private readonly children: Renderable[] = [];
  private readonly cache = new Map<Renderable, CacheEntry>();

  add(child: Renderable): void {
    this.children.push(child);
  }

  /** Remove all children (e.g. fullscreen container swap). */
  clear(): void {
    this.children.length = 0;
    this.cache.clear();
  }

  invalidate(): void {
    this.cache.clear();
    for (const c of this.children) c.invalidate?.();
  }

  /** Lines for one child, using the damage cache when valid. */
  private childLines(child: Renderable, width: number): string[] {
    const fp = child.fingerprint?.();
    const hasFingerprint = child.fingerprint !== undefined;
    const entry = this.cache.get(child);
    if (
      entry &&
      entry.rendered &&
      entry.width === width &&
      (!hasFingerprint || entry.fingerprint === fp)
    ) {
      return entry.lines;
    }
    const lines = child.render(width);
    this.cache.set(child, {
      fingerprint: fp,
      hasFingerprint,
      width,
      lines,
      rendered: true,
    });
    return lines;
  }

  render(width: number): string[] {
    const out: string[] = [];
    for (const child of this.children) {
      out.push(...this.childLines(child, width));
    }
    return out;
  }
}
