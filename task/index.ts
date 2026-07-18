// ============================================================
// Background Task Manager — Pi-style persistent task tracking
// ============================================================

import type { SubAgentTask } from "../swarm/types";
import { goalManager } from "../goal";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

export interface BackgroundTaskEntry {
  id: string;
  prompt: string;
  model: string;
  subagentType: string;
  status: "running" | "completed" | "failed" | "aborted";
  outputLines: string[];
  error?: string;
  stopReason?: string;          // Kimi Code: reason report to model
  startTime: number;
  createdAt: number;            // task creation timestamp (used for stale cleanup)
  endTime?: number;
  completedAtMs?: number;       // completion timestamp (set on complete/fail/restart-demotion)
  turns: number;
  usage: { input: number; output: number; cost: number };
}

const BG_ARRAY_ENTRY_TYPE = "muselinn_background_tasks"; // legacy full-snapshot entry
const BG_TASK_ENTRY_TYPE = "muselinn_background_task";   // incremental single-task entry

/** Strip a task down to its persisted shape (outputLines are not persisted). */
function serializeTask(t: BackgroundTaskEntry): Record<string, any> {
  return {
    id: t.id,
    prompt: t.prompt,
    model: t.model,
    subagentType: t.subagentType,
    status: t.status,
    error: t.error,
    stopReason: t.stopReason,
    startTime: t.startTime,
    createdAt: t.createdAt,
    endTime: t.endTime,
    completedAtMs: t.completedAtMs,
    turns: t.turns,
    usage: t.usage,
  };
}

// ============================================================
// BackgroundTaskManager — singleton
// ============================================================

class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTaskEntry>();
  private sessions = new Map<string, { session: any; unsubscribe: () => void }>();
  private taskWaiters = new Map<string, Array<() => void>>();
  private appendEntryFn: ((type: string, data: any) => void) | null = null;
  private notifyFn: ((msg: string, type?: string) => void) | null = null;

  /** Bind persistence and notification callbacks */
  bind(appendEntry: (type: string, data: any) => void, notify: (msg: string, type?: string) => void) {
    this.appendEntryFn = appendEntry;
    this.notifyFn = notify;
  }

  /** Register a new background task. Enforces a 50-task-per-session ceiling. */
  register(entry: BackgroundTaskEntry): void {
    if (this.tasks.size >= 50) {
      throw new Error("Maximum concurrent background tasks (50) reached for this session.");
    }
    this.tasks.set(entry.id, entry);
    this.persistTask(entry);
  }

  /** Store session handle for a running task */
  setSession(taskId: string, session: any, unsubscribe: () => void): void {
    this.sessions.set(taskId, { session, unsubscribe });
  }

  /** Get a task by ID */
  get(taskId: string): BackgroundTaskEntry | undefined {
    return this.tasks.get(taskId);
  }

  /** Get all tasks */
  list(): BackgroundTaskEntry[] {
    return [...this.tasks.values()];
  }

  /** Get only running tasks */
  listRunning(): BackgroundTaskEntry[] {
    return this.list().filter(t => t.status === "running");
  }

  /** Update task output lines */
  appendOutput(taskId: string, lines: string[]): void {
    const task = this.tasks.get(taskId);
    if (task) {
      task.outputLines.push(...lines);
    }
  }

  /** Get task output as string, with Read-style paging.
   *  Priority: offset/limit > tail > full. Paged output carries a header with
   *  the total line count so the caller can keep paging. */
  getOutput(taskId: string, tail?: number, offset?: number, limit?: number): string {
    const task = this.tasks.get(taskId);
    if (!task) return "[task not found]";
    const lines = task.outputLines;
    const totalLines = lines.length;

    const hasPaging = (offset !== undefined && offset > 0) || (limit !== undefined && limit > 0);
    if (hasPaging) {
      const start = Math.max(0, (offset && offset > 0 ? offset : 1) - 1); // 1-based → 0-based
      const end = limit && limit > 0 ? Math.min(totalLines, start + limit) : totalLines;
      const shown = lines.slice(start, end);
      return `[showing lines ${totalLines === 0 ? 0 : start + 1}-${end} of ${totalLines}]\n` + shown.join("\n");
    }
    if (tail && tail > 0) {
      const shown = lines.slice(-tail);
      return `[showing last ${shown.length} of ${totalLines} line(s)]\n` + shown.join("\n");
    }
    return lines.join("\n");
  }

  /** Add a waiter to be resolved when a task finishes (complete/fail/stop). */
  addWaiter(taskId: string, resolve: () => void): void {
    const waiters = this.taskWaiters.get(taskId);
    if (waiters) {
      waiters.push(resolve);
    } else {
      this.taskWaiters.set(taskId, [resolve]);
    }
  }

  /** Remove a previously registered waiter. */
  removeWaiter(taskId: string, resolve: () => void): void {
    const waiters = this.taskWaiters.get(taskId);
    if (!waiters) return;
    const idx = waiters.indexOf(resolve);
    if (idx >= 0) waiters.splice(idx, 1);
    if (waiters.length === 0) this.taskWaiters.delete(taskId);
  }

  /** Notify and clear all waiters for a task. */
  private notifyWaiters(taskId: string): void {
    const waiters = this.taskWaiters.get(taskId);
    if (!waiters) return;
    this.taskWaiters.delete(taskId);
    for (const resolve of waiters) {
      try { resolve(); } catch { /* ignore */ }
    }
  }

  /** Block until a running task finishes or the timeout elapses. */
  waitForDone(taskId: string, timeoutMs = 120000): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return Promise.resolve();
    return new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.removeWaiter(taskId, done);
        resolve();
      };
      this.addWaiter(taskId, done);
      const timer = setTimeout(done, timeoutMs);
    });
  }

  /** Mark task as completed */
  complete(taskId: string, outputLines: string[]): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "completed";
    task.endTime = Date.now();
    task.completedAtMs = task.endTime;
    task.outputLines = outputLines;

    // Cleanup session handle
    const handle = this.sessions.get(taskId);
    if (handle) {
      handle.unsubscribe();
      this.sessions.delete(taskId);
    }

    this.persistTask(task);
    this.notifyWaiters(taskId);
    this.notifyFn?.(`Background task ${taskId} completed`, "success");
  }

  /** Mark task as failed. Optional stopReason is preserved (e.g. timeout_30min). */
  fail(taskId: string, error: string, stopReason?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "failed";
    task.endTime = Date.now();
    task.completedAtMs = task.endTime;
    task.error = error;
    if (stopReason) task.stopReason = stopReason;

    const handle = this.sessions.get(taskId);
    if (handle) {
      handle.unsubscribe();
      this.sessions.delete(taskId);
    }

    this.persistTask(task);
    this.notifyWaiters(taskId);
    this.notifyFn?.(`Background task ${taskId} failed: ${error}`, "error");
  }

  /** Stop a running task. Kimi Code-style: records stopReason. */
  async stop(taskId: string, reason?: string): Promise<boolean> {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return false;

    const normalized = (reason || "User initiated stop").trim();
    task.stopReason = normalized;

    const handle = this.sessions.get(taskId);
    if (handle) {
      try {
        await handle.session.abort();
      } catch { /* ignore */ }
      handle.unsubscribe();
      this.sessions.delete(taskId);
    }

    task.status = "aborted";
    task.endTime = Date.now();
    task.completedAtMs = task.endTime;
    this.persistTask(task);
    this.notifyWaiters(taskId);
    this.notifyFn?.(`Background task ${taskId} stopped: ${normalized}`, "warning");
    return true;
  }

  /** Kimi Code-style: stop initiated by user (preserves cancellation identity). */
  async stopByUser(taskId: string): Promise<boolean> {
    return this.stop(taskId, "User cancelled");
  }

  /** Clear all completed/failed tasks */
  clearCompleted(): void {
    for (const [id, task] of this.tasks) {
      if (task.status !== "running") {
        this.tasks.delete(id);
      }
    }
    // Deletions can't be expressed incrementally — write a full snapshot so
    // restore drops the removed ids (snapshot resets the baseline).
    this.persistSnapshot();
  }

  /** Persist a single task change incrementally (append-only per-task entry). */
  private persistTask(task: BackgroundTaskEntry): void {
    if (!this.appendEntryFn) return;
    this.appendEntryFn(BG_TASK_ENTRY_TYPE, serializeTask(task));
  }

  /** Persist a full snapshot of all tasks (legacy array entry type). */
  private persistSnapshot(): void {
    if (!this.appendEntryFn) return;
    this.appendEntryFn(BG_ARRAY_ENTRY_TYPE, this.list().map(serializeTask));
  }

  /** Restore from persisted session entries.
   *  Accepts either the raw session entry list (preferred) or a legacy plain
   *  array of task objects. Handles both entry types:
   *   - "muselinn_background_tasks" (array): full snapshot — resets the merge
   *     baseline (used for deletions such as clearCompleted).
   *   - "muselinn_background_task" (single object): upserts one task; for the
   *     same id the later entry wins.
   *  Post-merge demotions:
   *   - Tasks older than 7 days are demoted to failed with stopReason="stale_7d".
   *   - Orphan running tasks (left "running" across a process restart) are
   *     demoted to "failed" with stopReason="process_restart" so the UI never
   *     shows zombie forever-running tasks after a crash/restart. */
  restore(entries: any[]): void {
    const now = Date.now();
    const STALE_AGE_MS = 7 * 86400 * 1000;

    // Merge phase: id → latest persisted data, in entry order.
    const merged = new Map<string, any>();
    let sawSessionEntries = false;
    for (const e of entries || []) {
      if (e && e.type === "custom") {
        sawSessionEntries = true;
        if (e.customType === BG_ARRAY_ENTRY_TYPE && Array.isArray(e.data)) {
          merged.clear(); // snapshot is authoritative up to this point
          for (const t of e.data) if (t && t.id) merged.set(t.id, t);
        } else if (e.customType === BG_TASK_ENTRY_TYPE && e.data && e.data.id) {
          merged.set(e.data.id, e.data);
        }
      }
    }
    if (!sawSessionEntries) {
      // Legacy call shape: plain array of task objects.
      for (const t of entries || []) {
        if (t && t.id) merged.set(t.id, t);
      }
    }

    // Demotion + insert phase (applied once per task to the final merged data).
    for (const e of merged.values()) {
      if (this.tasks.has(e.id)) continue;
      const createdAt = e.createdAt || e.startTime || now;
      const isStale = now - createdAt > STALE_AGE_MS;
      const wasRunning = e.status === "running";
      let status: BackgroundTaskEntry["status"] = e.status || "failed";
      let stopReason = e.stopReason;
      let endTime = e.endTime;
      let completedAtMs = e.completedAtMs;

      if (isStale) {
        status = "failed";
        stopReason = "stale_7d";
        endTime = now;
        completedAtMs = now;
      } else if (wasRunning) {
        status = "failed";
        stopReason = "process_restart";
        endTime = now;
        completedAtMs = now;
      }

      this.tasks.set(e.id, {
        ...e,
        status,
        stopReason,
        endTime,
        completedAtMs,
        createdAt,
        outputLines: [],
      });
    }
  }
}

export const backgroundManager = new BackgroundTaskManager();

// ============================================================
// Background Task Tools — register with Pi
// ============================================================

export function registerBackgroundTools(pi: any): void {
  // ── run_background tool ──
  pi.registerTool({
    name: "run_background",
    label: "Run Background Task",
    description: "Run a subagent as a background task. Returns immediately. Use task_list/task_output to check results.",
    promptSnippet: "run_background / task_list / task_output / task_stop: manage background tasks",
    promptGuidelines: [
      "Use run_background to dispatch a task that doesn't need immediate results",
      "Use task_list to check running/completed background tasks",
      "Use task_output to read the output of a completed task",
      "Use task_stop to cancel a running task",
      "Background tasks persist across turns and sessions",
    ],
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task prompt for the sub-agent" },
        model: { type: "string", description: "Optional model override" },
        subagent_type: { type: "string", enum: ["explore", "plan", "coder"], default: "explore" },
        output_path: { type: "string", description: "Optional file path. When set, the full task output is written to this file on completion (use Read with offset/limit to page through large outputs)." },
      },
      required: ["prompt"],
    },
    async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
      const taskId = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const models = ctx.modelRegistry?.getAvailable() || [];
      const model = models.find((m: any) => m.id === (params.model || models[0]?.id));
      if (!model) {
        return { content: [{ type: "text", text: "No model available." }] };
      }

      const resourceLoader = createSubagentResourceLoader(ctx);
      const tools = params.subagent_type === "coder"
        ? ["read", "bash", "edit", "write", "grep", "find", "ls"]
        : ["read", "grep", "find", "ls"];

      backgroundManager.register({
        id: taskId,
        prompt: params.prompt,
        model: model.id,
        subagentType: params.subagent_type || "explore",
        status: "running",
        outputLines: [],
        startTime: Date.now(),
        createdAt: Date.now(),
        turns: 0,
        usage: { input: 0, output: 0, cost: 0 },
      });

      // Run in background (not awaited)
      runBackgroundSession(taskId, model, params.prompt, tools, resourceLoader, signal, params.output_path);

      return {
        content: [{ type: "text", text: `Background task started. ID: ${taskId}\nUse task_list to check status, task_output(id) to see results.` }],
      };
    },
  });

  // ── task_list tool ──
  pi.registerTool({
    name: "task_list",
    label: "List Background Tasks",
    description: "List background tasks (running/completed/failed/aborted).",
    promptSnippet: "task_list: list background tasks",
    parameters: {
      type: "object",
      properties: {
        active_only: { type: "boolean", default: false, description: "Only list currently running tasks" },
      },
    },
    async execute(toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const tasks = params?.active_only ? backgroundManager.listRunning() : backgroundManager.list();
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: params?.active_only ? "No running background tasks." : "No background tasks." }] };
      }
      const lines = tasks.map(t => {
        const dur = t.startTime ? (t.endTime ? `${Math.floor((t.endTime - t.startTime) / 1000)}s` : "running") : "—";
        const reason = t.stopReason ? ` (${t.stopReason})` : "";
        return `  ${t.id} [${t.status}${reason}] ${t.prompt.slice(0, 60)} (${dur})`;
      });
      return { content: [{ type: "text", text: `Background tasks:\n${lines.join("\n")}` }] };
    },
  });

  // ── task_output tool ──
  pi.registerTool({
    name: "task_output",
    label: "Task Output",
    description: "Get output from a background task by ID.",
    promptSnippet: "task_output: read output from a background task",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID from run_background" },
        tail: { type: "number", description: "Only show last N lines (optional)" },
        offset: { type: "number", description: "1-based start line for paging (optional; offset/limit take precedence over tail)" },
        limit: { type: "number", description: "Max lines to return when paging (optional; offset/limit take precedence over tail)" },
        block: { type: "boolean", default: false, description: "Wait for the task to finish before returning output" },
        timeout: { type: "number", description: "Max seconds to wait when block=true (default 120, cap 600)" },
      },
      required: ["task_id"],
    },
    async execute(toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      if (params?.block) {
        const waitMs = Math.min(Math.max(params.timeout || 120, 1), 600) * 1000;
        await backgroundManager.waitForDone(params.task_id, waitMs);
      }
      const output = backgroundManager.getOutput(params.task_id, params.tail, params.offset, params.limit);
      return { content: [{ type: "text", text: output }] };
    },
  });

  // ── task_stop tool ──
  pi.registerTool({
    name: "task_stop",
    label: "Stop Task",
    description: "Stop a running background task by ID.",
    promptSnippet: "task_stop: stop a background task",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID from run_background" },
      },
      required: ["task_id"],
    },
    async execute(toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const ok = await backgroundManager.stop(params.task_id);
      return {
        content: [{ type: "text", text: ok ? `Task ${params.task_id} stopped.` : `Task ${params.task_id} not found or not running.` }],
      };
    },
  });
}

const BACKGROUND_TIMEOUT_MS = 30 * 60 * 1000; // Kimi Code-aligned: 30 min cap

async function runBackgroundSession(
  taskId: string,
  model: any,
  prompt: string,
  tools: string[],
  resourceLoader: any,
  signal: AbortSignal,
  outputPath?: string,
): Promise<void> {
  let session: any = null;
  let unsub: (() => void) | null = null;
  let unlinkAbort: (() => void) | null = null;
  let timedOut = false;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    try { session?.abort(); } catch { /* ignore */ }
  }, BACKGROUND_TIMEOUT_MS);
  try {
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      modelRegistry: { getAvailable: () => [model] } as any,
      tools,
      resourceLoader,
    });
    session = result.session;

    unsub = session.subscribe((event: any) => {
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const msg = event.message;
        const texts = (msg.content || []).filter((p: any) => p.type === "text");
        if (texts.length > 0) {
          backgroundManager.appendOutput(taskId, texts.map((p: any) => p.text || ""));
        }
      }
    });
    backgroundManager.setSession(taskId, session, unsub);

    // (1) Manual abort bridging — session.prompt does not accept { signal };
    // chain parent signal -> session.abort() so cancellation actually lands.
    // Mirrors the pattern in swarm/subagent.ts (linkAbortSignal + onAbort).
    if (signal.aborted) {
      try { session.abort(); } catch { /* ignore */ }
    } else {
      const onAbort = () => { try { session?.abort(); } catch { /* ignore */ } };
      signal.addEventListener("abort", onAbort, { once: true });
      unlinkAbort = () => {
        try { signal.removeEventListener("abort", onAbort); } catch { /* ignore */ }
      };
    }

    await session.prompt(prompt, { source: "extension" });

    // The 30-min timer fires via session.abort(), which may resolve (not
    // reject) prompt() — check the flag on the success path too.
    if (timedOut) {
      backgroundManager.fail(taskId, "Background task timed out after 30 minutes", "timeout_30min");
      return;
    }

    const msgs = session.state.messages;
    const allText = msgs
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => (m.content || []).filter((p: any) => p.type === "text").map((p: any) => p.text))
      .filter(Boolean);

    if (outputPath) {
      // Kimi Code-style: full output lands in output_path; the task entry keeps
      // only a pointer so in-memory outputLines stay small and Read can page.
      try {
        fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
        fs.writeFileSync(outputPath, allText.join("\n\n"), "utf-8");
        backgroundManager.complete(taskId, [
          `[output written to ${outputPath} — ${allText.length} message(s); use Read with offset/limit to page]`,
          ...allText.slice(-3),
        ]);
      } catch (writeErr: any) {
        backgroundManager.complete(taskId, [
          `[failed to write output_path ${outputPath}: ${writeErr?.message || writeErr}]`,
          ...allText,
        ]);
      }
    } else {
      backgroundManager.complete(taskId, allText);
    }
  } catch (err: any) {
    if (timedOut) {
      backgroundManager.fail(taskId, "Background task timed out after 30 minutes", "timeout_30min");
    } else {
      backgroundManager.fail(taskId, err.message || String(err));
    }
  } finally {
    // (2) Ensures cleanup runs on both success, prompt-abort, and exception paths.
    // dispose() was previously on the success path only; unsubscribe + abort
    // listener cleanup must also run when complete() throws or prompt rejects.
    clearTimeout(timeoutTimer);
    try { unlinkAbort?.(); } catch { /* ignore */ }
    try { unsub?.(); } catch { /* ignore */ }
    try { session?.dispose(); } catch { /* ignore */ }
  }
}

function createSubagentResourceLoader(ctx: any): any {
  return {
    getExtensions: () => ({ extensions: [], errors: [] }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => ctx.getSystemPrompt?.() || "",
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}
