// ============================================================
// Swarm Mode — Sub-agent Execution
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import { goalManager } from "../packages/core/goal";
import { permissionManager } from "../packages/core/permission";
import { wrapWithPermissionGate } from "../packages/core/swarm/wrap-tools";
import { progressEstimator } from "../packages/core/swarm/types";
import {
  CONFIG_DIR_NAME,
  createAgentSession,
  createCodingTools,
  createExtensionRuntime,
  createReadOnlyTools,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SubAgentType, SubAgentTask } from "../packages/core/swarm/types";
import { swarmState, setSwarmCancelled, setResumeResult, clearResumeResults, MAX_OUTPUT_LINES, OUTPUT_TRUNCATED_MARKER } from "../packages/core/swarm/types";
import { hookEngine } from "../packages/core/hooks/index";
import { loadSkillsForCwd } from "../packages/core/skills/index";
import type { AgentProfile } from "../packages/core/agent-file/types.ts";
import { toolPolicyService } from "../packages/core/tool-policy/index.ts";
import { agentLifecycle } from "../packages/core/agent-lifecycle/index.ts";

// Append one output line with a hard array-length cap (oldest dropped first).
function pushOutputLine(task: SubAgentTask, line: string): void {
  task.outputLines.push(line);
  if (task.outputLines.length > MAX_OUTPUT_LINES) {
    task.outputLines.splice(0, task.outputLines.length - MAX_OUTPUT_LINES);
  }
}

// Timeout & output limit constants (Kimi Code-aligned)
const SUBAGENT_TIMEOUT_MS = parseInt(process.env.KIMI_SUBAGENT_TIMEOUT_MS || "1800000", 10); // 30 min default (Kimi Code-aligned)
const MAX_OUTPUT_BYTES = 1 * 1024 * 1024; // 1 MiB (Kimi Code)

// ============================================================
// UserCancellationError — distinguishes user cancel from system errors
// ============================================================

export class UserCancellationError extends Error {
  readonly userCancelled = true;
  constructor() {
    super('Aborted by the user');
    this.name = 'AbortError';
  }
}

export function userCancellationReason(): UserCancellationError {
  return new UserCancellationError();
}

export function isUserCancellation(value: unknown): value is UserCancellationError {
  return value instanceof UserCancellationError;
}

// ============================================================
// linkAbortSignal — chain parent abort to child controller
// ============================================================

export function linkAbortSignal(source: AbortSignal, target: AbortController): () => void {
  const onAbort = () => {
    target.abort(source.reason || userCancellationReason());
  };
  if (source.aborted) {
    onAbort();
    return () => {};
  }
  source.addEventListener('abort', onAbort, { once: true });
  return () => {
    source.removeEventListener('abort', onAbort);
  };
}

// ============================================================
// log_swarm_warn — log non-AbortError failures without rethrowing
// ============================================================

function log_swarm_warn(label: string, e: unknown): void {
  if (e && (e as any)?.name === 'AbortError') return;
  console.error(`[swarm] ${label}: ${(e as any)?.message ?? e}`);
}

// ============================================================
// combineAbortSignals — AbortSignal.any polyfill (cleanup-safe)
// ============================================================

function combineAbortSignals(signals: AbortSignal[]): { signal: AbortSignal; cleanup: () => void } {
  const anyFn = (AbortSignal as any).any;
  if (typeof anyFn === 'function') {
    return { signal: anyFn.call(AbortSignal, signals) as AbortSignal, cleanup: () => {} };
  }
  // Polyfill: manually bridge each source into one controller.
  const controller = new AbortController();
  const offs: Array<() => void> = [];
  for (const s of signals) {
    if (s.aborted) {
      controller.abort((s as any).reason);
      break;
    }
    const onA = () => controller.abort((s as any).reason);
    s.addEventListener('abort', onA, { once: true });
    offs.push(() => { try { s.removeEventListener('abort', onA); } catch {} });
  }
  return { signal: controller.signal, cleanup: () => { for (const o of offs) o(); } };
}

// ============================================================
// Resource Loader for sub-agent sessions
// ============================================================

export function createSubagentResourceLoader(ctx: {
  getSystemPrompt?: () => string | undefined;
  cwd: string;
  /** Optional agent profile — overrides system prompt with profile's prompt template. */
  agentProfile?: AgentProfile;
}): ResourceLoader {
  // Use agent profile's system prompt when provided (with ${base_prompt} expansion)
  let basePrompt: string;
  if (ctx.agentProfile?.systemPrompt) {
    basePrompt = ctx.agentProfile.systemPrompt;
    // Replace ${base_prompt} with the session's default prompt
    const sessionPrompt = ctx.getSystemPrompt?.() || "";
    if (basePrompt.includes("${base_prompt}") && sessionPrompt) {
      basePrompt = basePrompt.replace(/\$\{base_prompt\}/g, sessionPrompt);
    }
  } else {
    basePrompt = ctx.getSystemPrompt?.() || "";
  }
  const systemPrompt = basePrompt
    .replace(/\nCurrent date and time:[^\n]*(?:\nCurrent working directory:[^\n]*)?$/u, "")
    .replace(/\nCurrent working directory:[^\n]*$/u, "")
    .trim();

  // Inject current goal into subagent prompt
  const goalInjection = goalManager.buildInjection();
  const enrichedPrompt = goalInjection
    ? `${systemPrompt}\n\n---\n${goalInjection}`
    : systemPrompt;

  const extensionsResult = { extensions: [], errors: [], runtime: createExtensionRuntime() };

  return {
    getExtensions: () => extensionsResult,
    // Kimi Code-style Agent Skills (project + user scopes) for subagent sessions.
    getSkills: () => loadSkillsForCwd(ctx.cwd || process.cwd()) as { skills: any[]; diagnostics: any[] },
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => enrichedPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

// ============================================================
// Model Selection
// ============================================================

// settings.json in-process cache, invalidated by mtime. Avoids a sync
// existsSync+readFileSync+JSON.parse on every tool execute while still
// picking up file changes immediately (mtime change forces a re-read).
let settingsCache: { mtimeMs: number; settings: any } | null = null;

function readSettingsCached(): any | null {
  const settingsPath = path.join(getAgentDir(), "settings.json");
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(settingsPath).mtimeMs;
  } catch {
    return null; // missing/unreadable — same as the old existsSync gate
  }
  if (settingsCache && settingsCache.mtimeMs === mtimeMs) {
    return settingsCache.settings;
  }
  try {
    const raw = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(raw);
    settingsCache = { mtimeMs, settings };
    return settings;
  } catch (settingsErr) {
    log_swarm_warn('readSettingsCached settings.json', settingsErr);
    return null;
  }
}

export function getDefaultModel(): string {
  const settings = readSettingsCached();
  if (settings?.defaultModel) return settings.defaultModel;
  return "";
}

export function getDefaultProvider(): string {
  const settings = readSettingsCached();
  if (settings?.defaultProvider) return settings.defaultProvider;
  return "";
}

// ============================================================
// Rate Limit Handling
// ============================================================

export function isRateLimitError(err: any): boolean {
  const msg = (err?.message || String(err || "")).toLowerCase();
  return /rate\s*limit|429|too many requests|retry\s*after|try again/i.test(msg);
}

export async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  maxRetries = 10,
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (isRateLimitError(err)) {
        // Mark goal as usage_limited if active
        goalManager.detectProviderLimitError(err?.message || String(err));
        if (attempt < maxRetries) {
          const delay =
            Math.min(1000 * Math.pow(2, attempt - 1) + Math.random() * 500, 10_000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err; // rate limit, last attempt
      }
      throw err; // non-rate-limit error
    }
  }
  throw new Error("Max retries exhausted");
}

// ============================================================
// Sub-agent Runner
// ============================================================

export async function runSubAgent(
  task: SubAgentTask,
  ctx: {
    cwd: string;
    getSystemPrompt?: () => string | undefined;
    modelRegistry: { getAvailable(): Array<{ id: string }>; runtime?: any };
  },
  signal: AbortSignal,
  onProgress: () => void,
  /** Optional agent profile to apply tool gating and custom system prompt. */
  agentProfile?: AgentProfile,
): Promise<void> {
  const agentId = task.id;
  const agentType = task.type;
  agentLifecycle.emit({ type: "agent.created", agentId, agentType, parentToolCallId: task.id });
  try { void hookEngine.fire("SubagentStart", { subagent_type: task.type, task_id: task.id }, { matcherText: task.type, cwd: ctx.cwd }); } catch { /* hooks fail open */ }
  try {
  const resourceLoader = createSubagentResourceLoader({ ...ctx, agentProfile });
  const models = ctx.modelRegistry.getAvailable();
  // Kimi Code-aligned built-in subagent tool sets:
  //  - coder:  full read/write + shell (default general-purpose agent)
  //  - explore: read-only (no edit/write/bash)
  //  - plan:    read-only, no shell at all (planning/architecture only)
  // Nested agent dispatch is intentionally not exposed to subagents.
  //
  // Tools are constructed here and wrapped with the permission gate: the
  // workers share the session's PermissionManager, so /mode switches
  // propagate to in-flight subagents by construction, and 'ask' verdicts
  // degrade to blocks (unattended workers cannot answer dialogs).
  const baseTools = task.type === "coder" ? createCodingTools(ctx.cwd) : createReadOnlyTools(ctx.cwd);
  const gatedTools = baseTools.map((t: any) =>
    wrapWithPermissionGate(t, (name, params) => permissionManager.evaluateForSubagent(name, params as Record<string, unknown>, ctx.cwd)),
  );

  // Parse provider:modelId or just modelId
  let targetProvider = "";
  let targetModelId = task.model;
  if (task.model.includes(":")) {
    const [p, m] = task.model.split(":");
    targetProvider = p;
    targetModelId = m;
  }

  const model = models.find((m: any) => {
    const idMatch = m.id === targetModelId;
    if (targetProvider) return idMatch && m.provider === targetProvider;
    return idMatch;
  });
  if (!model) {
    task.status = "failed";
    task.error = `Model "${task.model}" not found. Available: ${models.map((m: any) => `${m.provider}:${m.id}`).join(", ")}`;
    task.endTime = Date.now();
    task.completedAtMs = Date.now();
    task.progressPercent = 100;
    onProgress();
    return;
  }

  await runWithModel(model, task, ctx, resourceLoader, gatedTools, signal, onProgress);
  } finally {
    try { void hookEngine.fire("SubagentStop", { subagent_type: task.type, task_id: task.id, status: task.status }, { matcherText: task.type, cwd: ctx.cwd }); } catch { /* hooks fail open */ }
    agentLifecycle.emit({ type: "agent.disposed", agentId, agentType, parentToolCallId: task.id, status: task.status });
  }
}

async function runWithModel(
  model: any,
  task: SubAgentTask,
  ctx: { cwd: string; getSystemPrompt?: () => string | undefined; modelRegistry: any },
  resourceLoader: any,
  tools: any[],
  signal: AbortSignal,
  onProgress: () => void,
): Promise<void> {
  let session: any = null;
  let outputBytes = 0;
  let outputLimitExceeded = false;
  let timeoutAborted = false;
  // Hoisted so cleanupAbortListeners() works from outer catch/finally too.
  let combinedSignal: AbortSignal | undefined;
  let onCombinedAbort: (() => void) | undefined;
  let childController: AbortController | undefined;
  let unlink: (() => void) | undefined;
  let onAbort: (() => void) | undefined;
  let cleanupCombined: () => void = () => {};
  const cleanupAbortListeners = () => {
    try { if (childController && onAbort) childController.signal.removeEventListener("abort", onAbort); } catch (e) { log_swarm_warn('removeEventListener(onAbort) failed', e); }
    try { if (combinedSignal && onCombinedAbort) combinedSignal.removeEventListener("abort", onCombinedAbort); } catch (e) { log_swarm_warn('removeEventListener(onCombinedAbort) failed', e); }
    try { unlink?.(); } catch (e) { log_swarm_warn('unlink failed', e); }
    try { cleanupCombined(); } catch (e) { log_swarm_warn('cleanupCombined failed', e); }
  };
  try {
    // Combine cancel signal + timeout signal (polyfill when AbortSignal.any missing)
    const timeoutSignal = AbortSignal.timeout(SUBAGENT_TIMEOUT_MS);
    const combined = combineAbortSignals([signal, timeoutSignal]);
    combinedSignal = combined.signal;
    cleanupCombined = combined.cleanup;

    onCombinedAbort = () => {
      timeoutAborted = !signal.aborted;
      session?.abort();
    };
    if (combinedSignal.aborted) onCombinedAbort();
    else combinedSignal.addEventListener("abort", onCombinedAbort, { once: true });

    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      modelRuntime: (ctx.modelRegistry as any)?.runtime ?? ctx.modelRegistry,
      // Only the gated tools are enabled: default built-ins are disabled
      // and our wrapped replacements keep their names, so the permission
      // policy chain runs inside every worker tool call (shared manager
      // = /mode broadcast by construction).
      noTools: "builtin",
      customTools: tools,
      resourceLoader,
    });
    session = result.session;
    try { progressEstimator.markStarted(task.id, Date.now()); } catch (e) { log_swarm_warn('progressEstimator.markStarted failed', e); }

    const entry = { session, taskId: task.id };
    swarmState.activeSessions?.set(task.id, entry);

    const unsub = session.subscribe((event: any) => {
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const msg = event.message;
        task.turns++;
        if (msg.usage) {
          task.usage.input += msg.usage.input || 0;
          task.usage.output += msg.usage.output || 0;
          const adds = msg.usage.cost?.total ?? 0;
          task.usage.cost += adds;
        }
        task.progressPercent = Math.min(90, task.turns * 15 + 10);
        // Count tool calls for real progress tracking
        const toolCalls = (msg.content || []).filter((p: any) => p.type === "toolCall" || p.toolCallId).length;
        if (toolCalls > 0) {
          task.toolCalls += toolCalls;
          // Update estimator with new tool calls
          for (let i = 0; i < toolCalls; i++) progressEstimator.recordToolCall(task.id);
          const estimate = progressEstimator.estimate(task.id);
          if (estimate.confidence > 0) {
            task.estimatedTotalCalls = estimate.estimatedTotalCalls;
          } else {
            task.estimatedTotalCalls = Math.max(task.estimatedTotalCalls, Math.ceil(task.toolCalls * 1.5));
          }
        }
        const texts = (msg.content || []).filter((p: any) => p.type === "text");
        if (texts.length > 0) {
          const fullText = texts.map((p: any) => p.text || "").join("\n");
          // Track output size (Kimi Code-style 1 MiB limit)
          if (!outputLimitExceeded) {
            const textBytes = Buffer.byteLength(fullText, "utf-8");
            outputBytes += textBytes;
            if (outputBytes > MAX_OUTPUT_BYTES) {
              outputLimitExceeded = true;
              // Keep a single marker so the model can see truncation happened;
              // further text is dropped instead of appended.
              pushOutputLine(task, OUTPUT_TRUNCATED_MARKER);
              task.currentAction = "[output limit exceeded]";
            } else {
              pushOutputLine(task, fullText);
              task.currentAction = fullText.slice(0, 60) || "";
            }
          }
        }
        onProgress();
      }
    });

    // Link parent abort signal → child session
    childController = new AbortController();
    unlink = linkAbortSignal(signal, childController);
    onAbort = () => session?.abort();
    childController.signal.addEventListener("abort", onAbort, { once: true });

    task.status = "running";
    task.startTime = Date.now();
    onProgress();

    try {
      await retryOnRateLimit(() =>
        session.prompt(task.task, { source: "extension" }),
      );
    } catch (promptErr: any) {
      const wasAborted =
        signal.aborted ||
        (childController?.signal.aborted ?? false) ||
        swarmState.swarmCancelled;
      const wasTimeout = timeoutAborted;

      if (wasTimeout) {
        task.status = "failed";
        task.error = "Subagent timed out after " + (SUBAGENT_TIMEOUT_MS / 1000) + "s";
        task.endTime = Date.now();
        task.completedAtMs = Date.now();
        task.progressPercent = 100;
        try { progressEstimator.markFailed(task.id, Date.now()); } catch (e) { log_swarm_warn('progressEstimator.markFailed failed', e); }
        onProgress();
        setResumeResult(task.id, { status: "failed", output: task.error });
        cleanupAbortListeners();
        unsub();
        swarmState.activeSessions?.delete(task.id);
        return;
      }

      if (wasAborted) {
        task.status = "aborted";
        task.endTime = Date.now();
        task.completedAtMs = Date.now();
        task.progressPercent = 100;
        onProgress();
        setResumeResult(task.id, { status: "aborted" });
        cleanupAbortListeners();
        unsub();
        swarmState.activeSessions?.delete(task.id);
        return;
      }
      log_swarm_warn('prompt failed', promptErr);
      task.status = "failed";
      task.endTime = Date.now();
      task.completedAtMs = Date.now();
      task.error = promptErr.message || String(promptErr);
      task.progressPercent = 100;
      try { progressEstimator.markFailed(task.id, Date.now()); } catch (e) { log_swarm_warn('progressEstimator.markFailed failed', e); }
      onProgress();
      setResumeResult(task.id, { status: "failed", output: promptErr.message });
      cleanupAbortListeners();
      unsub();
      swarmState.activeSessions?.delete(task.id);
      return;
    }

    cleanupAbortListeners();

    task.endTime = Date.now();
    task.completedAtMs = Date.now();
    task.progressPercent = 100;
    const msgs = session.state.messages;

    // Extract full output from session messages (supplements subscribe-captured text)
    const allText = msgs
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => (m.content || []).filter((p: any) => p.type === "text").map((p: any) => p.text))
      .filter(Boolean);
    if (allText.length > 0) {
      // Bound the final replacement too: keep the newest lines, drop oldest,
      // and flag truncation so downstream consumers know output was cut.
      task.outputLines = allText.length > MAX_OUTPUT_LINES
        ? [OUTPUT_TRUNCATED_MARKER, ...allText.slice(-MAX_OUTPUT_LINES)]
        : allText;
    }

    let hasNonToolTurn = false;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant") {
        const reason = (m as any).stopReason;
        if (reason === "aborted") {
          task.status = "aborted";
        } else if (reason === "error") {
          task.status = "failed";
          task.error = (m as any).errorMessage || "Unknown error";
        } else {
          task.status = "done";
          hasNonToolTurn = true;
          // Store result for resume
          const lastTexts = (m.content || []).filter((p: any) => p.type === "text");
          const output = lastTexts.length > 0 ? lastTexts[lastTexts.length - 1].text : "";
          setResumeResult(task.id, { status: "done", output: output?.slice(0, 500) });
        }
        if (m.usage) {
          task.usage.input += m.usage.input || 0;
          task.usage.output += m.usage.output || 0;
          const adds = m.usage.cost?.total ?? 0;
          task.usage.cost += adds || 0;
        }
        break;
      }
    }

    if (!hasNonToolTurn && task.status === "done" && msgs.length <= 1) {
      task.status = "done";
    }

    // Notify estimator of final status
    const nowMs = Date.now();
    if (task.status === "done" || task.status === "failed") {
      try {
        if (task.status === "done") progressEstimator.markCompleted(task.id, nowMs);
        else progressEstimator.markFailed(task.id, nowMs);
      } catch (e) { log_swarm_warn('progressEstimator final-mark failed', e); }
    }

    unsub();
    swarmState.activeSessions?.delete(task.id);
    onProgress();
  } catch (initErr: any) {
    log_swarm_warn('runWithModel init failed', initErr);
    task.status = "failed";
    task.endTime = Date.now();
    task.completedAtMs = Date.now();
    task.error = initErr.message || String(initErr);
    task.progressPercent = 100;
    try { progressEstimator.markFailed(task.id, Date.now()); } catch (e) { log_swarm_warn('progressEstimator.markFailed failed', e); }
    setResumeResult(task.id, { status: "failed", output: initErr.message || String(initErr) });
    cleanupAbortListeners();
    swarmState.activeSessions?.delete(task.id);
    onProgress();
  } finally {
    // Defensive: ensure abort listeners are unlinked even if an unexpected
    // throw skipped every return path. Safe to call multiple times.
    cleanupAbortListeners();
    if (session) {
      try {
        session.dispose();
      } catch (e) {
        log_swarm_warn('session.dispose failed', e);
      }
    }
  }
}

// ============================================================
// Parallel Execution
// ============================================================

/**
 * Worker-pool execution with optional transitional disbursement.
 * Honors max_concurrency by launching up to maxC workers that pull from a
 * shared queue. Rate-limit retry remains inside runSubAgent.
 *
 * When disburseOptions is provided, the first batch is launched synchronously
 * and the pool is filled to maxC after one spacing interval — preserving the
 * Kimi Code-style "initial 5 + 700ms spacing" feel while bounding concurrency.
 */
export async function runProgressive<T>(
  items: T[],
  maxConcurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  disburseOptions?: { initialBatch: number; spacingMs: number },
): Promise<void> {
  // Each runProgressive invocation launches a fresh swarm batch — clear any
  // resume results accumulated by previous swarms so they don't leak across runs.
  clearResumeResults();
  const total = items.length;
  if (total === 0) return;

  const maxC = Math.max(1, Math.min(maxConcurrency, 128));
  let next = 0;
  const workers: Promise<void>[] = [];

  const worker = async () => {
    while (true) {
      const idx = next++;
      if (idx >= total) return;
      await fn(items[idx], idx);
    }
  };

  if (disburseOptions) {
    // Transitional disbursement: seed initial batch synchronously, then fill to maxC.
    const firstBatch = Math.min(maxC, disburseOptions.initialBatch, total);
    for (let i = 0; i < firstBatch; i++) {
      workers.push(worker());
    }
    if (maxC > firstBatch && total > firstBatch) {
      await sleep(disburseOptions.spacingMs);
      for (let i = firstBatch; i < maxC; i++) {
        workers.push(worker());
      }
    }
  } else {
    for (let i = 0; i < maxC; i++) {
      workers.push(worker());
    }
  }

  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
