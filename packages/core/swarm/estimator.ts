// ============================================================
// Progress Estimator — Kimi Code-style tool call progress prediction
// ============================================================
//
// Predicts each agent's total tool calls based on completed agents'
// historical data using geometric mean. When agents complete, their
// tool call count feeds into the prior, which is used to estimate
// remaining agents' expected total.

const DEFAULT_WORKLOAD_SPREAD_FACTOR = 1.5;
const DEFAULT_CONFIDENCE_SCALE = 4;
const MIN_SAMPLES_FOR_PRIOR = 1;
const HALF_TICK = 0.5;

export interface ProgressEstimate {
  readonly rawTicks: number;
  readonly estimatedTotalCalls: number;
  readonly confidence: number;
}

interface MemberState {
  toolCalls: number;
  startedAtMs?: number;
  terminalAtMs?: number;
  terminalKind?: 'completed' | 'failed';
}

interface CompletedSample {
  readonly toolCalls: number;
}

interface EstimatePrior {
  readonly completedCount: number;
  readonly typicalToolCalls: number;
  readonly typicalRatePerMs: number;
}

export class ProgressEstimator {
  private readonly members = new Map<string, MemberState>();
  private readonly workloadSpreadFactor: number;

  constructor(options: { workloadSpreadFactor?: number } = {}) {
    this.workloadSpreadFactor = options.workloadSpreadFactor ?? DEFAULT_WORKLOAD_SPREAD_FACTOR;
  }

  /** Ensure a member exists for tracking */
  ensureMember(memberKey: string): void {
    if (!this.members.has(memberKey)) {
      this.members.set(memberKey, { toolCalls: 0 });
    }
  }

  /** Record a tool call for a member */
  recordToolCall(memberKey: string): void {
    const state = this.getOrCreate(memberKey);
    state.toolCalls++;
  }

  /** Mark a member as started */
  markStarted(memberKey: string, nowMs: number): void {
    const state = this.getOrCreate(memberKey);
    state.startedAtMs = nowMs;
  }

  /** Mark a member as completed */
  markCompleted(memberKey: string, nowMs: number): void {
    const state = this.getOrCreate(memberKey);
    state.terminalAtMs = nowMs;
    state.terminalKind = 'completed';
  }

  /** Mark a member as failed */
  markFailed(memberKey: string, nowMs: number): void {
    const state = this.getOrCreate(memberKey);
    state.terminalAtMs = nowMs;
    state.terminalKind = 'failed';
  }

  /**
   * Estimate total tool calls for a member.
   * Uses geometric mean of completed agents' tool calls as prior.
   * Falls back to the member's own toolCalls * spread factor when no prior.
   */
  estimate(memberKey: string): ProgressEstimate {
    const state = this.getOrCreate(memberKey);
    const rawTicks = state.toolCalls;
    const prior = this.buildPrior();

    if (!prior || prior.completedCount < MIN_SAMPLES_FOR_PRIOR) {
      // No prior data: use raw ticks * spread factor as rough estimate
      return {
        rawTicks,
        estimatedTotalCalls: Math.max(1, Math.ceil(rawTicks * this.workloadSpreadFactor)),
        confidence: 0,
      };
    }

    // Geometric interpolate between prior and current member's own rate
    const confidence = confidenceScore(rawTicks, DEFAULT_CONFIDENCE_SCALE);
    const estimatedTotalCalls = geometricInterpolate(
      prior.typicalToolCalls * this.workloadSpreadFactor,
      Math.max(rawTicks * this.workloadSpreadFactor, 1),
      confidence,
    );

    return {
      rawTicks,
      estimatedTotalCalls: Math.max(1, Math.ceil(estimatedTotalCalls)),
      confidence: prior.completedCount > 3 ? 1 : confidence,
    };
  }

  /** Clear all member state */
  reset(): void {
    this.members.clear();
  }

  // ── Private ──────────────────────────────────────────────

  private getOrCreate(memberKey: string): MemberState {
    let state = this.members.get(memberKey);
    if (!state) {
      state = { toolCalls: 0 };
      this.members.set(memberKey, state);
    }
    return state;
  }

  /** Build prior from completed agents' data */
  private buildPrior(): EstimatePrior | undefined {
    const samples = this.completedSamples();
    if (samples.length === 0) return undefined;

    return {
      completedCount: samples.length,
      typicalToolCalls: geometricMean(samples.map((s) => s.toolCalls)),
      typicalRatePerMs: geometricMean(samples.map((s) => (s.toolCalls + HALF_TICK) / 1)),
    };
  }

  /** Get completed samples */
  private completedSamples(): CompletedSample[] {
    const samples: CompletedSample[] = [];
    for (const state of this.members.values()) {
      if (state.terminalKind !== 'completed') continue;
      if (state.toolCalls <= 0) continue;
      samples.push({ toolCalls: state.toolCalls });
    }
    return samples;
  }
}

// ── Math Helpers ───────────────────────────────────────────

function confidenceScore(count: number, scale: number): number {
  return 1 - Math.exp(-Math.max(0, count) / scale);
}

function geometricMean(values: number[]): number {
  if (values.length === 0) return 1;
  const logs = values
    .filter((v) => v > 0)
    .map((v) => Math.log(v));
  if (logs.length === 0) return 1;
  return Math.exp(logs.reduce((a, b) => a + b, 0) / logs.length);
}

function geometricInterpolate(low: number, high: number, weight: number): number {
  const safeLow = Math.max(Number.EPSILON, low);
  const safeHigh = Math.max(Number.EPSILON, high);
  return Math.exp((1 - weight) * Math.log(safeLow) + weight * Math.log(safeHigh));
}
