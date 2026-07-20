// ============================================================
// TUI — Render timing probe (pure, no pi imports).
//
// Enabled via PI_MUSELINN_HARNESS_TUI_TIMING=1. Wraps hot render()
// paths (custom editor, bottom filler) and keeps a bounded ring of
// samples per probe name; /tui timing prints P50/P99. The env var is
// read once (render hot path must not re-parse process.env per frame).
// ============================================================

export interface TimingStats {
  count: number;
  mean: number;
  p50: number;
  p99: number;
  max: number;
}

export class RenderTiming {
  private samples = new Map<string, number[]>();
  private readonly cap: number;

  constructor(cap: number = 240) {
    this.cap = cap;
  }

  record(name: string, ms: number): void {
    let arr = this.samples.get(name);
    if (!arr) {
      arr = [];
      this.samples.set(name, arr);
    }
    arr.push(ms);
    if (arr.length > this.cap) arr.splice(0, arr.length - this.cap);
  }

  stats(name: string): TimingStats | null {
    const arr = this.samples.get(name);
    if (!arr || arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
      count: sorted.length,
      mean: sum / sorted.length,
      p50: pick(0.5),
      p99: pick(0.99),
      max: sorted[sorted.length - 1],
    };
  }

  format(): string {
    if (this.samples.size === 0) return "timing: no samples yet";
    const parts: string[] = [];
    for (const name of [...this.samples.keys()].sort()) {
      const s = this.stats(name);
      if (!s) continue;
      parts.push(
        `${name}: n=${s.count} mean=${s.mean.toFixed(2)}ms p50=${s.p50.toFixed(2)}ms p99=${s.p99.toFixed(2)}ms max=${s.max.toFixed(2)}ms`,
      );
    }
    return parts.join("\n");
  }

  reset(): void {
    this.samples.clear();
  }
}

/** Shared probe instance. */
export const renderTiming = new RenderTiming();

let enabledCache: boolean | null = null;

/** Env-gated on/off, resolved once (override via setTimingEnabledForTests). */
export function isTimingEnabled(): boolean {
  if (enabledCache !== null) return enabledCache;
  const v = (process.env.PI_MUSELINN_HARNESS_TUI_TIMING || "").toLowerCase();
  enabledCache = v === "1" || v === "true" || v === "on";
  return enabledCache;
}

/** Test hook: force the gate and bypass the env cache. */
export function setTimingEnabledForTests(value: boolean | null): void {
  enabledCache = value;
}
