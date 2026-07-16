// ============================================================
// Swarm Mode — Sub-agent Execution
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";
import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
import { goalManager } from "../goal";
import {
  CONFIG_DIR_NAME,
  createAgentSession,
  createExtensionRuntime,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { SubAgentType, SubAgentTask } from "./types";
import { activeSessions, swarmCancelled, setSwarmCancelled, globalAbortController, setResumeResult } from "./types";

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
// Resource Loader for sub-agent sessions
// ============================================================

export function createSubagentResourceLoader(ctx: {
  getSystemPrompt?: () => string | undefined;
  cwd: string;
}): ResourceLoader {
  const basePrompt = ctx.getSystemPrompt?.() || "";
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
    getSkills: () => ({ skills: [], diagnostics: [] }),
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

export function getDefaultModel(): string {
  try {
    const settingsPath = path.join(getAgentDir(), "settings.json");
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw);
      if (settings.defaultModel) return settings.defaultModel;
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function getDefaultProvider(): string {
  try {
    const settingsPath = path.join(getAgentDir(), "settings.json");
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(raw);
      if (settings.defaultProvider) return settings.defaultProvider;
    }
  } catch {
    /* ignore */
  }
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
  maxRetries = 3,
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
    modelRegistry: { getAvailable(): Array<{ id: string }> };
  },
  signal: AbortSignal,
  onProgress: () => void,
): Promise<void> {
  const resourceLoader = createSubagentResourceLoader(ctx);
  const models = ctx.modelRegistry.getAvailable();
  const allTools =
    task.type === "coder"
      ? ["read", "bash", "edit", "write", "grep", "find", "ls"]
      : ["read", "grep", "find", "ls"];

  const model = models.find((m: any) => m.id === task.model);
  if (!model) {
    task.status = "failed";
    task.error = `Model "${task.model}" not found in registry. Available: ${models.map((m: any) => m.id).join(", ")}`;
    task.endTime = Date.now();
    task.completedAtMs = Date.now();
    task.progressPercent = 100;
    onProgress();
    return;
  }

  await runWithModel(model, task, ctx, resourceLoader, allTools, signal, onProgress);
}

async function runWithModel(
  model: any,
  task: SubAgentTask,
  ctx: { cwd: string; getSystemPrompt?: () => string | undefined; modelRegistry: any },
  resourceLoader: any,
  tools: string[],
  signal: AbortSignal,
  onProgress: () => void,
): Promise<void> {
  let session: any = null;
  try {
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      modelRegistry: ctx.modelRegistry as any,
      tools,
      resourceLoader,
    });
    session = result.session;

    const entry = { session, taskId: task.id };
    activeSessions?.set(task.id, entry);

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
        const texts = (msg.content || []).filter((p: any) => p.type === "text");
        if (texts.length > 0) {
          task.currentAction = texts[texts.length - 1].text?.slice(0, 60) || "";
        }
        onProgress();
      }
    });

    // Link parent abort signal → child session
    const childController = new AbortController();
    const unlink = linkAbortSignal(signal, childController);
    const onAbort = () => session?.abort();
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
        childController.signal.aborted ||
        swarmCancelled;

      if (wasAborted) {
        task.status = "aborted";
        task.endTime = Date.now();
    task.completedAtMs = Date.now();
        task.progressPercent = 100;
        onProgress();
        setResumeResult(task.id, { status: "aborted" });
        childController.signal.removeEventListener("abort", onAbort);
        unlink();
        unsub();
        activeSessions?.delete(task.id);
        return;
      }
      task.status = "failed";
      task.endTime = Date.now();
    task.completedAtMs = Date.now();
      task.error = promptErr.message || String(promptErr);
      task.progressPercent = 100;
      onProgress();
      setResumeResult(task.id, { status: "failed", output: promptErr.message });
      childController.signal.removeEventListener("abort", onAbort);
      unsub();
      activeSessions?.delete(task.id);
      return;
    }

    childController.signal.removeEventListener("abort", onAbort);
    unlink();

    task.endTime = Date.now();
    task.completedAtMs = Date.now();
    task.progressPercent = 100;
    const msgs = session.state.messages;

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

    unsub();
    activeSessions?.delete(task.id);
    onProgress();
  } catch (initErr: any) {
    task.status = "failed";
    task.endTime = Date.now();
    task.completedAtMs = Date.now();
    task.error = initErr.message || String(initErr);
    task.progressPercent = 100;
    setResumeResult(task.id, { status: "failed", output: initErr.message || String(initErr) });
    activeSessions?.delete(task.id);
    onProgress();
  } finally {
    if (session) {
      try {
        session.dispose();
      } catch {
        /* ignore */
      }
    }
  }
}

// ============================================================
// Parallel Execution
// ============================================================

export async function runParallel<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    workers.push(
      (async () => {
        while (next < items.length) {
          const idx = next++;
          if (idx >= items.length) break;
          await fn(items[idx]);
        }
      })(),
    );
  }
  await Promise.all(workers);
}
