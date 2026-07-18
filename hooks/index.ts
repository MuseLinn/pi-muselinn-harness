// ============================================================
// Hooks Engine — Kimi Code-style user-configured hooks
//
// Rules live in config.toml [[hooks]] entries (see hooks/config.ts). When an
// event fires, matching rules run in parallel with the event payload as JSON
// on stdin; exit code / stdout semantics live in hooks/executor.ts.
//
// Blockable events: PreToolUse, Stop, UserPromptSubmit — any blocking rule
// blocks, reasons are concatenated in rule order. All other events are
// observational (fire-and-forget). Every trigger is mirrored onto the pi
// EventBus as `hooks:<EventName>` when available.
//
// Failure policy: the engine never throws into the agent flow. Config parse
// errors, spawn failures, timeouts, and crashes all fail open.
// ============================================================

import { getHookRules, type HookRule } from "./config";
import { runHookCommand, interpretResult, type HookVerdict } from "./executor";

export interface FireOptions {
  /** Await results and aggregate block decisions (PreToolUse/Stop/UserPromptSubmit). */
  blockable?: boolean;
  /** Text the rule's matcher regex is tested against. */
  matcherText?: string;
  /** Working directory for rule lookup and hook execution. */
  cwd?: string;
  /** Session identifier for the payload. */
  sessionId?: string;
  /** Advanced/test override: explicit project-layer config path, or null to skip. */
  projectConfig?: string | null;
}

export interface FireAggregate {
  blocked: boolean;
  reasons: string[];
  /** Plain-text stdout from exit-0 hooks (appended to model context). */
  outputs: string[];
}

const EMPTY_AGGREGATE: FireAggregate = { blocked: false, reasons: [], outputs: [] };

/** Max consecutive Stop-hook injections before we stop re-steering (loop guard). */
const MAX_CONSECUTIVE_STOP_BLOCKS = 3;

function safeStringify(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload);
  } catch {
    // Unserializable event field (circular/BigInt) — fall back to base fields.
    try {
      return JSON.stringify({
        hook_event_name: payload.hook_event_name,
        session_id: payload.session_id,
        cwd: payload.cwd,
      });
    } catch {
      return "{}";
    }
  }
}

export class HookEngine {
  private pi: any = null;
  private defaultCwd: string = process.cwd();
  private sessionId: string = "default";
  private consecutiveStopBlocks = 0;

  /** Bind the pi ExtensionAPI (for the EventBus mirror + Stop steering). */
  bindPi(pi: any): void {
    this.pi = pi;
  }

  /** Update ambient context (called on session_start). */
  setSessionContext(ctx: { cwd?: string; sessionId?: string }): void {
    if (ctx.cwd) this.defaultCwd = ctx.cwd;
    if (ctx.sessionId) this.sessionId = ctx.sessionId;
  }

  /**
   * Fire one hook event. Matching rules run in parallel; identical command
   * strings run once. Observational events return immediately (hooks run in
   * the background); blockable events await and aggregate verdicts in rule
   * order. Never throws.
   */
  async fire(
    eventName: string,
    fields: Record<string, unknown> = {},
    opts: FireOptions = {},
  ): Promise<FireAggregate> {
    try {
      const cwd = opts.cwd || this.defaultCwd;
      let rules: HookRule[];
      try {
        rules = getHookRules(cwd, { projectConfig: opts.projectConfig }).filter((r) => r.event === eventName);
      } catch {
        return EMPTY_AGGREGATE;
      }
      if (rules.length === 0) return EMPTY_AGGREGATE;

      const matcherText = opts.matcherText ?? "";
      const matched = rules.filter((r) => {
        if (!r.matcher) return true;
        try {
          return r.matcher.test(matcherText);
        } catch {
          return false;
        }
      });
      if (matched.length === 0) return EMPTY_AGGREGATE;

      // Identical commands for the same event run once.
      const seen = new Set<string>();
      const unique: HookRule[] = [];
      for (const r of matched) {
        if (seen.has(r.command)) continue;
        seen.add(r.command);
        unique.push(r);
      }

      const payload: Record<string, unknown> = {
        hook_event_name: eventName,
        session_id: opts.sessionId || this.sessionId,
        cwd,
        ...fields,
      };
      this.mirror(eventName, payload);
      const stdinJson = safeStringify(payload);

      if (!opts.blockable) {
        // Observational: fire-and-forget, never awaited.
        void Promise.allSettled(unique.map((r) => this.runOne(r, stdinJson, cwd)));
        return EMPTY_AGGREGATE;
      }

      const results = await Promise.allSettled(unique.map((r) => this.runOne(r, stdinJson, cwd)));
      const agg: FireAggregate = { blocked: false, reasons: [], outputs: [] };
      for (let i = 0; i < unique.length; i++) {
        const res = results[i];
        if (res.status !== "fulfilled") continue;
        const v = res.value;
        if (v.blocked) {
          agg.blocked = true;
          agg.reasons.push(v.reason || `blocked by hook: ${unique[i].command}`);
        } else if (v.output) {
          agg.outputs.push(v.output);
        }
      }
      return agg;
    } catch {
      return EMPTY_AGGREGATE;
    }
  }

  private async runOne(rule: HookRule, stdinJson: string, cwd: string): Promise<HookVerdict> {
    try {
      const r = await runHookCommand(rule.command, stdinJson, rule.timeout, cwd);
      return interpretResult(r);
    } catch {
      return { blocked: false };
    }
  }

  /** Mirror to pi's shared EventBus (`hooks:<EventName>`), defensively. */
  private mirror(eventName: string, payload: Record<string, unknown>): void {
    try {
      this.pi?.events?.emit?.(`hooks:${eventName}`, payload);
    } catch { /* EventBus unavailable or a listener threw — ignore */ }
  }

  /**
   * Stop-event handling: when a Stop hook blocks, steer the model to keep
   * going with the hook's reason. A consecutive-block counter guards against
   * hooks that block unconditionally (would otherwise loop forever); the
   * counter resets on every UserPromptSubmit.
   */
  async handleStop(pi: any, cwd?: string): Promise<void> {
    const agg = await this.fire("Stop", {}, { blockable: true, cwd });
    if (!agg.blocked) {
      this.consecutiveStopBlocks = 0;
      return;
    }
    this.consecutiveStopBlocks++;
    if (this.consecutiveStopBlocks > MAX_CONSECUTIVE_STOP_BLOCKS) {
      console.warn(`[hooks] Stop hook blocked ${this.consecutiveStopBlocks} times in a row — not re-steering (loop guard)`);
      return;
    }
    const reason = agg.reasons.join("\n");
    try {
      await pi.sendUserMessage(
        `A Stop hook requests that you continue working. Reason:\n${reason}`,
        { deliverAs: "steer" },
      );
    } catch {
      try {
        await pi.sendUserMessage(`A Stop hook requests that you continue working. Reason:\n${reason}`);
      } catch { /* stale pi — session already gone */ }
    }
  }

  /** True when Stop steering is still allowed (exported for tests). */
  get stopBlockCount(): number {
    return this.consecutiveStopBlocks;
  }
}

export const hookEngine = new HookEngine();

// ============================================================
// registerHooks — wire all pi events to the engine
// ============================================================

export function registerHooks(pi: any, initialCtx?: any): void {
  hookEngine.bindPi(pi);
  if (initialCtx) {
    try {
      hookEngine.setSessionContext({
        cwd: initialCtx.cwd,
        sessionId: initialCtx.sessionManager?.getSessionId?.(),
      });
    } catch { /* ok */ }
  }

  // ── UserPromptSubmit (blockable; matcher against the user's text) ──
  pi.on("input", async (event: any, ctx: any) => {
    try {
      const text = event?.text ?? "";
      const agg = await hookEngine.fire(
        "UserPromptSubmit",
        { prompt: text, source: event?.source },
        { blockable: true, matcherText: text, cwd: ctx?.cwd },
      );
      if (agg.blocked) {
        try { ctx?.ui?.notify?.(`Blocked by hook: ${agg.reasons.join("; ")}`, "warning"); } catch { /* ok */ }
        return { action: "handled" };
      }
      if (agg.outputs.length > 0) {
        // Exit-0 stdout is appended to the prompt context (Kimi Code semantics).
        return { action: "transform", text: `${text}\n\n${agg.outputs.join("\n")}` };
      }
    } catch { /* hook failures never break input flow */ }
    return undefined; // continue unmodified
  });

  // ── PreToolUse is wired at the front of the existing tool_call handler in
  //    index.ts (Kimi Code: hooks run before permission checks). ──

  // ── PostToolUse / PostToolUseFailure (observational) ──
  pi.on("tool_result", (event: any, ctx: any) => {
    try {
      const isError = !!event?.isError;
      void hookEngine.fire(
        isError ? "PostToolUseFailure" : "PostToolUse",
        {
          tool_name: event?.toolName,
          tool_input: event?.input,
          tool_call_id: event?.toolCallId,
          is_error: isError,
        },
        { matcherText: event?.toolName ?? "", cwd: ctx?.cwd },
      );
    } catch { /* ok */ }
  });

  // ── Stop (blockable → steer the model to continue) ──
  pi.on("agent_settled", (_event: any, ctx: any) => {
    try {
      void hookEngine.handleStop(pi, ctx?.cwd);
    } catch { /* ok */ }
  });

  // ── StopFailure + Interrupt (observational) ──
  pi.on("turn_end", (event: any, ctx: any) => {
    try {
      const msg = event?.message;
      if (msg?.role === "assistant" && msg?.stopReason === "error") {
        const errText = msg?.errorMessage || "unknown";
        void hookEngine.fire("StopFailure", { error: errText }, { matcherText: errText, cwd: ctx?.cwd });
      }
      if (event?.signal?.aborted) {
        void hookEngine.fire("Interrupt", { reason: "user_interrupt" }, { cwd: ctx?.cwd });
      }
    } catch { /* ok */ }
  });

  // ── SessionStart (matcher: startup | resume) ──
  pi.on("session_start", (event: any, ctx: any) => {
    try {
      hookEngine.setSessionContext({
        cwd: ctx?.cwd,
        sessionId: ctx?.sessionManager?.getSessionId?.(),
      });
      const reason = event?.reason === "startup" ? "startup" : "resume";
      void hookEngine.fire("SessionStart", { reason }, { matcherText: reason, cwd: ctx?.cwd });
    } catch { /* ok */ }
  });

  // ── SessionEnd (matcher: exit) ──
  pi.on("session_shutdown", (_event: any, ctx: any) => {
    try {
      void hookEngine.fire("SessionEnd", { reason: "exit" }, { matcherText: "exit", cwd: ctx?.cwd });
    } catch { /* ok */ }
  });

  // ── PreCompact / PostCompact (matcher: manual | auto-ish reason) ──
  pi.on("session_before_compact", (event: any, ctx: any) => {
    try {
      const reason = event?.reason || "auto";
      void hookEngine.fire("PreCompact", { reason }, { matcherText: reason, cwd: ctx?.cwd });
    } catch { /* ok */ }
  });
  pi.on("session_compact", (event: any, ctx: any) => {
    try {
      const reason = event?.reason || "auto";
      void hookEngine.fire("PostCompact", { reason }, { matcherText: reason, cwd: ctx?.cwd });
    } catch { /* ok */ }
  });

  // ── SubagentStart/SubagentStop: swarm/subagent.ts + task/index.ts ──
  // ── PermissionRequest/PermissionResult: permission/index.ts ask path ──
  // ── Notification: task/index.ts backgroundManager notify sites ──
}
