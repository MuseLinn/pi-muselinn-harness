// ============================================================
// Cron Task Manager — Kimi Code-style scheduled prompts
// ============================================================

export interface CronTask {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  createdAt: number;
  lastFireAt?: number;
  nextFireAt?: string; // local ISO string with UTC offset
  stale: boolean;
  jitterSeconds: number;
}

interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
}

const MAX_CRON_TASKS = 50;
const STALE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CRON_ENTRY_TYPE = "muselinn_cron_tasks";

// ============================================================
// Cron expression parsing (5-field: min hour dom mon dow)
// ============================================================

function parseCronField(value: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  const parts = value.split(",").map(p => p.trim()).filter(Boolean);

  for (const part of parts) {
    if (part === "*") {
      for (let i = min; i <= max; i++) result.add(i);
      continue;
    }

    if (part.startsWith("*/")) {
      const step = parseInt(part.slice(2), 10);
      if (Number.isNaN(step) || step <= 0) {
        throw new Error(`Invalid step expression: ${part}`);
      }
      for (let i = min; i <= max; i += step) result.add(i);
      continue;
    }

    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (Number.isNaN(start) || Number.isNaN(end) || start < min || end > max || start > end) {
        throw new Error(`Invalid range expression: ${part}`);
      }
      for (let i = start; i <= end; i++) result.add(i);
      continue;
    }

    const n = parseInt(part, 10);
    if (Number.isNaN(n) || n < min || n > max) {
      throw new Error(`Invalid cron value: ${part}`);
    }
    result.add(n);
  }

  if (result.size === 0) {
    throw new Error(`Empty cron field: ${value}`);
  }

  return result;
}

function parseCronExpression(cron: string): CronFields {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Cron expression must have exactly 5 fields (min hour dom mon dow), got: ${fields.length}`);
  }

  return {
    minutes: parseCronField(fields[0], 0, 59),
    hours: parseCronField(fields[1], 0, 23),
    dom: parseCronField(fields[2], 1, 31),
    months: parseCronField(fields[3], 1, 12),
    dow: parseCronField(fields[4], 0, 6),
  };
}

// ============================================================
// Jitter: deterministic hash(taskId), capped at min(10% period, 15min)
// ============================================================

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function estimatePeriodMinutes(parsed: CronFields): number {
  // Brute-force the actual period: find the next two grid fire times and
  // diff them. Accurate for any field combination (e.g. "*/5 * * * *" -> 5),
  // unlike heuristic field-size math which mis-estimates dense crons.
  try {
    const now = new Date();
    const t1 = computeNextFireAt(parsed, 0, now);
    const t2 = computeNextFireAt(parsed, 0, new Date(t1.getTime() + 1000));
    const periodMin = (t2.getTime() - t1.getTime()) / 60000;
    if (periodMin > 0 && Number.isFinite(periodMin)) return periodMin;
  } catch { /* fall through to safe default */ }
  return 24 * 60;
}

function computeJitterSeconds(taskId: string, parsed: CronFields): number {
  const periodMinutes = estimatePeriodMinutes(parsed);
  const capMinutes = Math.min(periodMinutes * 0.1, 15);
  const maxSeconds = Math.max(0, Math.floor(capMinutes * 60));
  if (maxSeconds <= 0) return 0;
  return hashString(taskId) % maxSeconds;
}

// ============================================================
// Next fire time computation (local timezone)
// ============================================================

function matchesCron(d: Date, fields: CronFields): boolean {
  return (
    fields.minutes.has(d.getMinutes()) &&
    fields.hours.has(d.getHours()) &&
    fields.dom.has(d.getDate()) &&
    fields.months.has(d.getMonth() + 1) &&
    fields.dow.has(d.getDay())
  );
}

function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const offH = Math.floor(Math.abs(offset) / 60);
  const offM = Math.abs(offset) % 60;
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(offH)}:${pad(offM)}`
  );
}

function computeNextFireAt(fields: CronFields, jitterSeconds: number, after: Date): Date {
  const d = new Date(after.getTime());
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);

  // Search up to ~1 year ahead to avoid infinite loops on malformed cron
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (matchesCron(d, fields)) {
      const fire = new Date(d.getTime() + jitterSeconds * 1000);
      if (fire > after) return fire;
    }
    d.setMinutes(d.getMinutes() + 1);
  }

  throw new Error("Unable to compute next fire time for cron expression");
}

function isStale(task: CronTask, now: number): boolean {
  return now - task.createdAt > STALE_AGE_MS;
}

// ============================================================
// CronManager — singleton
// ============================================================

class CronManager {
  private tasks = new Map<string, CronTask>();
  private sendPromptFn: ((prompt: string) => Promise<void> | void) | null = null;
  private appendEntryFn: ((type: string, data: any) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Bind the host prompt sender + persistence callback. Narrow injection:
   *  cron only needs "put a prompt into the main conversation" — the pi
   *  adapter wires pi.sendUserMessage, the fork wires its own. */
  bindPromptSender(sendPrompt: (prompt: string) => Promise<void> | void, appendEntry: (type: string, data: any) => void): void {
    this.sendPromptFn = sendPrompt;
    this.appendEntryFn = appendEntry;
  }

  /** Register a new cron task */
  create(cron: string, prompt: string, recurring: boolean): { ok: boolean; task?: CronTask; error?: string } {
    if (this.tasks.size >= MAX_CRON_TASKS) {
      return { ok: false, error: `Maximum of ${MAX_CRON_TASKS} cron tasks allowed per session.` };
    }

    let parsed: CronFields;
    try {
      parsed = parseCronExpression(cron);
    } catch (e: any) {
      return { ok: false, error: `Invalid cron expression: ${e.message}` };
    }

    const id = `cron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const jitterSeconds = computeJitterSeconds(id, parsed);
    const now = new Date();
    const nextFireAt = toLocalISO(computeNextFireAt(parsed, jitterSeconds, now));

    const task: CronTask = {
      id,
      cron,
      prompt,
      recurring,
      createdAt: Date.now(),
      stale: false,
      jitterSeconds,
      nextFireAt,
    };

    this.tasks.set(id, task);
    this.persist();
    this.ensureTimer();
    return { ok: true, task };
  }

  /** Delete a cron task by ID */
  delete(id: string): boolean {
    const existed = this.tasks.delete(id);
    if (existed) {
      this.persist();
      if (this.tasks.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    }
    return existed;
  }

  /** Get all cron tasks (stale flag refreshed; one-shot tasks never go stale) */
  list(): CronTask[] {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      task.stale = task.recurring && isStale(task, now);
    }
    return [...this.tasks.values()];
  }

  /** Restore from persisted session entries */
  restore(entries: any[]): void {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as any;
      if (e.type === "custom" && e.customType === CRON_ENTRY_TYPE && Array.isArray(e.data)) {
        for (const raw of e.data) {
          if (raw?.id && !this.tasks.has(raw.id)) {
            const task: CronTask = {
              id: raw.id,
              cron: raw.cron || "* * * * *",
              prompt: raw.prompt || "",
              recurring: raw.recurring !== false,
              createdAt: raw.createdAt || Date.now(),
              lastFireAt: raw.lastFireAt,
              nextFireAt: raw.nextFireAt,
              stale: false,
              jitterSeconds: raw.jitterSeconds ?? 0,
            };
            task.stale = task.recurring && isStale(task, Date.now());
            // Stale recurring tasks are dropped on restore instead of revived.
            if (task.stale) continue;
            // Recompute next fire if missing or malformed
            if (!task.nextFireAt) {
              try {
                const parsed = parseCronExpression(task.cron);
                const js = task.jitterSeconds ?? computeJitterSeconds(task.id, parsed);
                task.jitterSeconds = js;
                task.nextFireAt = toLocalISO(computeNextFireAt(parsed, js, new Date()));
              } catch {
                continue;
              }
            }
            this.tasks.set(task.id, task);
          }
        }
        break;
      }
    }
    // Only arm the 30s interval when there is actually something to fire —
    // an always-on setInterval keeps the event loop alive forever and
    // prevents `pi -p` from exiting after the answer is printed.
    if (this.tasks.size > 0) this.ensureTimer();
  }

  /** Persist to session */
  private persist(): void {
    if (!this.appendEntryFn) return;
    const now = Date.now();
    const data = this.list().map(t => ({
      id: t.id,
      cron: t.cron,
      prompt: t.prompt,
      recurring: t.recurring,
      createdAt: t.createdAt,
      lastFireAt: t.lastFireAt,
      nextFireAt: t.nextFireAt,
      stale: t.recurring && (t.stale || isStale(t, now)),
      jitterSeconds: t.jitterSeconds,
    }));
    this.appendEntryFn(CRON_ENTRY_TYPE, data);
  }

  private ensureTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), 30_000);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const nowMs = now.getTime();

    // Pass 1: refresh stale flags and auto-delete stale recurring tasks,
    // even when they are not due to fire (7-day stale cleanup).
    let removedStale = false;
    for (const task of this.tasks.values()) {
      task.stale = task.recurring && isStale(task, nowMs);
      if (task.stale) {
        this.tasks.delete(task.id);
        removedStale = true;
      }
    }
    if (removedStale) this.persist();

    // Stop the timer when nothing is scheduled anymore.
    if (this.tasks.size === 0) {
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
      return;
    }

    const toFire: CronTask[] = [];
    for (const task of this.tasks.values()) {
      if (!task.nextFireAt) continue;
      const fireTime = new Date(task.nextFireAt).getTime();
      if (!Number.isNaN(fireTime) && fireTime <= nowMs) {
        toFire.push(task);
      }
    }

    if (toFire.length === 0) return;

    for (const task of toFire) {
      await this.fire(task);

      if (!task.recurring || task.stale) {
        this.tasks.delete(task.id);
      } else {
        try {
          const parsed = parseCronExpression(task.cron);
          task.lastFireAt = nowMs;
          task.nextFireAt = toLocalISO(computeNextFireAt(parsed, task.jitterSeconds, new Date(nowMs + 1)));
        } catch (e: any) {
          console.error(`[cron] failed to reschedule ${task.id}:`, e.message);
          this.tasks.delete(task.id);
        }
      }
    }

    this.persist();
  }

  private async fire(task: CronTask): Promise<void> {
    try {
      // Inject the prompt into the main conversation through the bound
      // sender. If unbound, log a clear fallback rather than pretending.
      if (this.sendPromptFn) {
        await this.sendPromptFn(task.prompt);
      } else {
        console.log(`[cron] fire ${task.id}: ${task.prompt.slice(0, 80)}... (no prompt sender bound)`);
      }
    } catch (e: any) {
      console.error(`[cron] fire ${task.id} failed:`, e.message || String(e));
    }
  }
}

export const cronManager = new CronManager();

// ============================================================
// Cron Tools — register with Pi
// ============================================================

export function registerCronTools(pi: any): void {
  cronManager.bindPromptSender(
    async (prompt) => { await pi.sendUserMessage(prompt); },
    // Guard: cron fires from a 30s interval that may outlive the session;
    // appendEntry on a stale pi throws.
    (type, data) => { try { pi.appendEntry?.(type, data); } catch { /* stale ctx */ } },
  );

  // ── cron_create tool ──
  pi.registerTool({
    name: "cron_create",
    label: "Create Cron Task",
    description: "Schedule a prompt to fire on a 5-field cron expression (min hour dom mon dow).",
    promptSnippet: "cron_create / cron_list / cron_delete: manage scheduled prompts",
    promptGuidelines: [
      "Use cron_create to schedule a recurring or one-shot prompt",
      "Cron format: minute hour day-of-month month day-of-week",
      "Supports * and */N steps; local timezone",
      "Use cron_list to view scheduled tasks",
      "Use cron_delete to remove a task by ID",
    ],
    parameters: {
      type: "object",
      properties: {
        cron: { type: "string", description: "5-field cron expression: min hour dom mon dow" },
        prompt: { type: "string", description: "Prompt to inject into the main conversation when the cron fires" },
        recurring: { type: "boolean", description: "Recurring (true, default) or one-shot (false, auto-deletes after fire)", default: true },
      },
      required: ["cron", "prompt"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const recurring = params.recurring !== false;
      const result = cronManager.create(params.cron, params.prompt, recurring);
      if (!result.ok) {
        return { content: [{ type: "text", text: result.error! }] };
      }
      const t = result.task!;
      const mode = t.recurring ? "recurring" : "one-shot";
      return {
        content: [{
          type: "text",
          text: `Cron task created. ID: ${t.id}\nMode: ${mode}\nNext fire: ${t.nextFireAt}`,
        }],
      };
    },
  });

  // ── cron_delete tool ──
  pi.registerTool({
    name: "cron_delete",
    label: "Delete Cron Task",
    description: "Delete a scheduled cron task by ID.",
    promptSnippet: "cron_delete: remove a scheduled task",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Cron task ID from cron_create or cron_list" },
      },
      required: ["id"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const ok = cronManager.delete(params.id);
      return {
        content: [{ type: "text", text: ok ? `Cron task ${params.id} deleted.` : `Cron task ${params.id} not found.` }],
      };
    },
  });

  // ── cron_list tool ──
  pi.registerTool({
    name: "cron_list",
    label: "List Cron Tasks",
    description: "List all scheduled cron tasks with next fire time and stale status.",
    promptSnippet: "cron_list: list scheduled tasks",
    parameters: { type: "object", properties: {} },
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const tasks = cronManager.list();
      if (tasks.length === 0) {
        return { content: [{ type: "text", text: "No cron tasks scheduled." }] };
      }
      const lines = tasks.map(t => {
        const mode = t.recurring ? "recurring" : "one-shot";
        const staleMark = t.stale ? " [stale]" : "";
        return `  ${t.id} [${mode}${staleMark}] ${t.cron} -> ${t.nextFireAt || "—"}\n    ${t.prompt.slice(0, 60)}`;
      });
      return { content: [{ type: "text", text: `Cron tasks:\n${lines.join("\n")}` }] };
    },
  });
}
