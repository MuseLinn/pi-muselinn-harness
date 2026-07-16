// ============================================================
// Background Task Manager — Pi-style persistent task tracking
// ============================================================

import type { SubAgentTask } from "../swarm/types";
import { goalManager } from "../goal";
import {
  createAgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

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
  endTime?: number;
  turns: number;
  usage: { input: number; output: number; cost: number };
}

// ============================================================
// BackgroundTaskManager — singleton
// ============================================================

class BackgroundTaskManager {
  private tasks = new Map<string, BackgroundTaskEntry>();
  private sessions = new Map<string, { session: any; unsubscribe: () => void }>();
  private appendEntryFn: ((type: string, data: any) => void) | null = null;
  private notifyFn: ((msg: string, type?: string) => void) | null = null;

  /** Bind persistence and notification callbacks */
  bind(appendEntry: (type: string, data: any) => void, notify: (msg: string, type?: string) => void) {
    this.appendEntryFn = appendEntry;
    this.notifyFn = notify;
  }

  /** Register a new background task */
  register(entry: BackgroundTaskEntry): void {
    this.tasks.set(entry.id, entry);
    this.persist();
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

  /** Get task output as string */
  getOutput(taskId: string, tail?: number): string {
    const task = this.tasks.get(taskId);
    if (!task) return "[task not found]";
    const lines = task.outputLines;
    if (tail && tail > 0) {
      return lines.slice(-tail).join("\n");
    }
    return lines.join("\n");
  }

  /** Mark task as completed */
  complete(taskId: string, outputLines: string[]): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "completed";
    task.endTime = Date.now();
    task.outputLines = outputLines;

    // Cleanup session handle
    const handle = this.sessions.get(taskId);
    if (handle) {
      handle.unsubscribe();
      this.sessions.delete(taskId);
    }

    this.persist();
    this.notifyFn?.(`Background task ${taskId} completed`, "success");
  }

  /** Mark task as failed */
  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = "failed";
    task.endTime = Date.now();
    task.error = error;

    const handle = this.sessions.get(taskId);
    if (handle) {
      handle.unsubscribe();
      this.sessions.delete(taskId);
    }

    this.persist();
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
    this.persist();
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
    this.persist();
  }

  /** Persist to session */
  private persist(): void {
    if (!this.appendEntryFn) return;
    const data = this.list().map(t => ({
      id: t.id,
      prompt: t.prompt,
      model: t.model,
      subagentType: t.subagentType,
      status: t.status,
      error: t.error,
      stopReason: t.stopReason,
      startTime: t.startTime,
      endTime: t.endTime,
      turns: t.turns,
      usage: t.usage,
    }));
    this.appendEntryFn("muselinn_background_tasks", data);
  }

  /** Restore from persisted entries */
  restore(entries: any[]): void {
    for (const e of entries) {
      if (e.id && !this.tasks.has(e.id)) {
        this.tasks.set(e.id, {
          ...e,
          outputLines: [],
        });
      }
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
        turns: 0,
        usage: { input: 0, output: 0, cost: 0 },
      });

      // Run in background (not awaited)
      runBackgroundSession(taskId, model, params.prompt, tools, resourceLoader, signal);

      return {
        content: [{ type: "text", text: `Background task started. ID: ${taskId}\nUse task_list to check status, task_output(id) to see results.` }],
      };
    },
  });

  // ── task_list tool ──
  pi.registerTool({
    name: "task_list",
    label: "List Background Tasks",
    description: "List all background tasks (running/completed/failed/aborted).",
    promptSnippet: "task_list: list background tasks",
    parameters: { type: "object", properties: {} },
    async execute(toolCallId: string, _params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const tasks = backgroundManager.list();
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No background tasks." }] };
      }
      const lines = tasks.map(t => {
        const dur = t.startTime ? (t.endTime ? `${Math.floor((t.endTime - t.startTime) / 1000)}s` : "running") : "—";
        return `  ${t.id} [${t.status}] ${t.prompt.slice(0, 60)} (${dur})`;
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
      },
      required: ["task_id"],
    },
    async execute(toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const output = backgroundManager.getOutput(params.task_id, params.tail);
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

async function runBackgroundSession(
  taskId: string,
  model: any,
  prompt: string,
  tools: string[],
  resourceLoader: any,
  signal: AbortSignal,
): Promise<void> {
  try {
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      modelRegistry: { getAvailable: () => [model] } as any,
      tools,
      resourceLoader,
    });
    const session = result.session;

    const unsub = session.subscribe((event: any) => {
      if (event.type === "message_end" && event.message?.role === "assistant") {
        const msg = event.message;
        const texts = (msg.content || []).filter((p: any) => p.type === "text");
        if (texts.length > 0) {
          backgroundManager.appendOutput(taskId, texts.map((p: any) => p.text || ""));
        }
      }
    });
    backgroundManager.setSession(taskId, session, unsub);

    await session.prompt(prompt, { source: "extension" });

    const msgs = session.state.messages;
    const allText = msgs
      .filter((m: any) => m.role === "assistant")
      .flatMap((m: any) => (m.content || []).filter((p: any) => p.type === "text").map((p: any) => p.text))
      .filter(Boolean);

    backgroundManager.complete(taskId, allText);
    session.dispose();
  } catch (err: any) {
    backgroundManager.fail(taskId, err.message || String(err));
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
