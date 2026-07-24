// ============================================================
// Todo — todo tool + inline panel widget + reminder system.
//
// Phase model ported from oh-my-pi's todo.ts. The tool accepts
// ops (init/start/done/drop/rm/append/view) and the widget
// renders phases as a tree with roman numerals.
// ============================================================

import {
  todoMatchesAnyDescription,
  setActiveTodoDescriptionsProvider,
  getActiveTodoDescriptions,
  type TodoItem,
  type TodoPhase,
  type TodoOpParams,
  applyOp,
  applyOpsToPhases,
  clonePhases,
  summarizePhases,
  summarizeTodos,
  formatSummary,
  selectVisibleTodos,
  formatPhaseDisplayName,
  phaseRomanNumeral,
  TODO_ENTRY_TYPE,
  type PhaseCounts,
} from "../packages/core/todo/types";

// ── Runtime state ──────────────────────────────────────────────

interface TodoRuntime {
  phases: TodoPhase[];
  expanded: boolean;
  appendEntry: ((type: string, data: any) => void) | null;
  ctx: any;
  // Reminder state
  reminderCount: number;
  reminderPending: boolean;
  awaitingProgress: boolean;
  mutationsSinceLastTodoTouch: number;
}

const MAX_REMINDERS = 3;

export const rt: TodoRuntime = {
  phases: [],
  expanded: false,
  appendEntry: null,
  ctx: null,
  reminderCount: 0,
  reminderPending: false,
  awaitingProgress: false,
  mutationsSinceLastTodoTouch: 0,
};

// ── Rendering ──────────────────────────────────────────────────

function statusMarker(status: TodoItem["status"], theme: any): string {
  switch (status) {
    case "in_progress": return theme.fg("accent", "●");
    case "completed":   return theme.fg("success", "✓");
    case "abandoned":   return theme.fg("dim", "✗");
    default:            return theme.fg("dim", "○");
  }
}

function styleContent(content: string, status: TodoItem["status"], theme: any, hasNotes?: number): string {
  if (status === "completed" || status === "abandoned") return theme.fg("dim", "\x1b[9m" + content + "\x1b[29m");
  if (status === "in_progress") return theme.fg("bright", content + (hasNotes ? " \x1b[2m+\x1b[22m" + hasNotes : ""));
  return content;
}

function buildWidgetLines(theme: any): string[] | undefined {
  const { phases } = rt;
  const activeDescriptions = getActiveTodoDescriptions();
  if (phases.length === 0) return undefined;

  const counts = summarizePhases(phases);
  const lines: string[] = [];

  // Header
  const head = theme.fg("dim", `─ todo (${counts.in_progress} active · ${counts.pending} pending · ${counts.completed} done) ─`);
  lines.push(head);

  if (rt.expanded) {
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      const done = phase.tasks.filter((t) => t.status === "completed" || t.status === "abandoned").length;
      const label = phases.length > 1 ? formatPhaseDisplayName(phase.name, i + 1) : phase.name;
      const phaseLine = `${label}  ${done}/${phase.tasks.length}`;
      const highlighted = phase.tasks.some((t) => t.status === "in_progress");
      lines.push(highlighted ? theme.fg("accent", theme.bold(phaseLine)) : phaseLine);
      for (const task of phase.tasks) {
        const notesCount = task.notes?.length ?? 0;
      const agentMatch = task.status === "pending" && todoMatchesAnyDescription(task.content, activeDescriptions);
      const marker = agentMatch ? theme.fg("success", theme.spinnerFrame?.() ?? "◔") : statusMarker(task, theme);
      const styled = styleContent(task.content, task.status, theme, notesCount);
      const line = agentMatch ? `${marker} ${theme.fg("success", styled)}` : `  ${marker} ${styled}`;
      lines.push(line);
      }
    }
    lines.push(theme.fg("dim", "alt+t collapse"));
  } else {
    // Collapsed: active phase tasks + summary
    const flat = phases.flatMap((p) => p.tasks);
    const { rows, hidden, hiddenCounts } = selectVisibleTodos(phases);
    // Show phase header for first visible item's phase
    for (const task of rows) {
      const notesCount = task.notes?.length ?? 0;
      const agentMatch = task.status === "pending" && todoMatchesAnyDescription(task.content, activeDescriptions);
      const marker = agentMatch ? theme.fg("success", theme.spinnerFrame?.() ?? "◔") : statusMarker(task, theme);
      const styled = styleContent(task.content, task.status, theme, notesCount);
      const line = agentMatch ? `${marker} ${theme.fg("success", styled)}` : `  ${marker} ${styled}`;
      lines.push(line);
    }
    if (hidden > 0) {
      lines.push(theme.fg("dim", `… +${hidden} more · alt+t expand`));
    }
  }

  return lines;
}

export function refreshWidget(): void {
  const ctx = rt.ctx;
  if (!ctx || !ctx.widget) return;
  if (rt.phases.length === 0) {
    ctx.widget(null);
    return;
  }
  const theme = ctx.theme || {};
  ctx.widget(buildWidgetLines(theme));
}

// ── Persistence ────────────────────────────────────────────────

export function persist(): void {
  if (!rt.appendEntry) return;
  try { rt.appendEntry(TODO_ENTRY_TYPE, { phases: rt.phases }); } catch { /* stale ctx */ }
}

/**
 * Restore the latest persisted list from session entries.
 * Handles both old flat format ({todos: [{id, title, status}]}) and
 * new phase format ({phases: [{name, tasks: [{content, status}]}]}).
 */
export function restoreTodos(entries: any[]): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type !== "custom" || e.customType !== TODO_ENTRY_TYPE) continue;
    const data = e.data;
    if (!data) continue;
    // New phase format
    if (Array.isArray(data.phases)) {
      rt.phases = data.phases.map((p: any) => ({
        name: p.name || "Tasks",
        tasks: (p.tasks || []).filter((t: any) => t && typeof t.content === "string"),
      }));
      return;
    }
    // Old flat format (backward compat)
    if (Array.isArray(data.todos)) {
      const oldTodos = data.todos.filter((t: any) => t && typeof t.title === "string");
      if (oldTodos.length > 0) {
        rt.phases = [{
          name: "Tasks",
          tasks: oldTodos.map((t: any) => ({
            content: t.title,
            status: t.status === "done" ? "completed" as const : (t.status === "in_progress" ? "in_progress" as const : "pending" as const),
          })),
        }];
        return;
      }
    }
  }
  rt.phases = [];
}

// ── Session wiring ─────────────────────────────────────────────

export function bindTodoSession(ctx: any, appendEntry: (type: string, data: any) => void): void {
  rt.ctx = ctx;
  rt.appendEntry = appendEntry;
}

export function clearTodoSession(): void {
  rt.phases = [];
  rt.reminderCount = 0;
  rt.reminderPending = false;
  rt.awaitingProgress = false;
  rt.mutationsSinceLastTodoTouch = 0;
  refreshWidget();

}

// ── Tool registration ──────────────────────────────────────────

export function registerTodoList(pi: any): void {
  pi.registerTool({
    name: "todo_list",
    label: "Todo List",
    promptSnippet: "todo_list: manage a phased task plan (init / start / done / drop / rm / append / view)",
    promptGuidelines: [
      "Use op=init with list=[{phase, items}] to initialize a full phased plan covering the whole request",
      "Use op=start task=... to mark a task in_progress (only one in_progress at a time)",
      "Use op=done task=... to mark a task completed; omit task to mark all open tasks done",
      "Use op=append phase=... items=[...] to add tasks to an existing phase",
      "Keep tasks to concise 5-10 word labels",
      "Call todo_list after completing tasks to keep progress visible — reminders fire if you stop with open items",
    ],
    parameters: {
      type: "object",
      properties: {
        op: {
          type: "string",
          enum: ["init", "start", "done", "rm", "drop", "append", "add_notes", "update_details", "view"],
          description: "Operation to apply",
        },
        list: {
          type: "array",
          description: "Phased task list (for init): [{phase, items}]",
          items: {
            type: "object",
            properties: {
              phase: { type: "string", description: "Phase name" },
              items: { type: "array", items: { type: "string" }, description: "Task contents" },
            },
            required: ["phase", "items"],
          },
        },
        task: {
          type: "string",
          description: "Task content to target (for start/done/drop/rm)",
        },
        phase: {
          type: "string",
          description: "Phase name (for done/drop/rm/append)",
        },
        items: {
          type: "array",
          items: { type: "string" },
          description: "Tasks to append (for append, or flat init fallback)",
        notes: {
          type: "array",
          items: { type: "string" },
          description: "Notes to attach (for add_notes op)",
        },
        },
      },
      required: ["op"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const op = String(params?.op ?? "");
      const entry: TodoOpParams = {
        op: op as TodoOpParams["op"],
        list: params.list,
        notes: params.notes,
        task: params.task,
        phase: params.phase,
        items: params.items,
      };

      const { phases, errors } = applyOp(rt.phases, entry);
      if (errors.length > 0) {
        return { content: [{ type: "text", text: `Errors: ${errors.join("; ")}` }] };
      }
      rt.phases = phases;
      persist();
      refreshWidget();

      // Reset reminder tracking on successful todo mutation
      rt.reminderCount = 0;
      rt.awaitingProgress = false;
      rt.reminderPending = false;
      rt.mutationsSinceLastTodoTouch = 0;

      return { content: [{ type: "text", text: formatSummary(rt.phases, []), details: { phases: clonePhases(rt.phases) } }] };
    },
  });

  // alt+t toggles the panel's expanded view (ctrl+t is pi built-in thinking toggle).

  // Wire default subagent descriptions provider to swarm state
  try {
    const { swarmState } = require("../packages/core/swarm/types");
    setActiveTodoDescriptionsProvider(() => {
      const tasks = swarmState.currentSwarm?.tasks;
      if (!tasks) return [];
      return tasks
        .filter((t) => t.status === "running" || t.status === "pending")
        .map((t) => t.task ?? t.description ?? "")
        .filter(Boolean);
    });
  } catch { /* swarm module not available */ }

  // Wire event-driven widget refresh for subagent matching
  pi.on("tool_result", () => { refreshWidget(); });
  pi.on("agent_start", () => { refreshWidget(); });
  pi.on("agent_end", () => { refreshWidget(); });


  pi.registerShortcut("alt+t", {
    description: "Expand/collapse the todo panel",
    handler: () => {
      if (rt.phases.length === 0) return;
      rt.expanded = !rt.expanded;
      refreshWidget();
    },
  });
}

// ── Reminder system ────────────────────────────────────────────

/**
 * Register todo reminder hooks on the pi object.
 * Call this after registerTodoList.
 *
 * The reminder flow:
 *   agent_settled → check incomplete → set flag + increment counter (if ≤ MAX_REMINDERS)
 *   context (next turn) → if flag set, inject <system-reminder> into system message, clear flag
 *   tool_result → reset counter, clear flags
 */
export function registerTodoReminders(pi: any): void {
  // Track tool_result for `todo` tool to reset reminder state
  pi.on("tool_result", (event: any) => {
    if (event?.toolName === "todo_list") {
      rt.reminderCount = 0;
      rt.awaitingProgress = false;
      rt.reminderPending = false;
      return;
    }
    // Count mutations for mid-run nudge
    if (event?.isError === false) {
      rt.mutationsSinceLastTodoTouch = (rt.mutationsSinceLastTodoTouch || 0) + 1;
    }
  });


  // context: inject system-reminder if flag is set
  pi.on("context", (event: any) => {
    if (!rt.reminderPending) return;
    rt.reminderPending = false;
    rt.awaitingProgress = true;
    rt.mutationsSinceLastTodoTouch = 0;

    const text = buildReminderText();
    if (!text) return;

    // Inject into the system message (same pattern as goalManager)
    if (!event.messages) return;
    const sysMsg = event.messages.find((m: any) => m.role === "system");
    if (sysMsg) {
      sysMsg.content = Array.isArray(sysMsg.content)
        ? [...sysMsg.content, { type: "text", text }]
        : [{ type: "text", text: sysMsg.content }, { type: "text", text }];
    } else {
      event.messages.unshift({ role: "system", content: [{ type: "text", text }] });
    }
  });

  // agent_settled: if there are incomplete todos, the agent stopped
  pi.on("agent_settled", () => {
    if (rt.reminderCount >= MAX_REMINDERS) return;
    if (rt.awaitingProgress) return;

    const incomplete = countIncomplete(rt.phases);
    if (incomplete === 0) return;

    rt.reminderCount++;
    rt.reminderPending = true;
  });
}

function countIncomplete(phases: TodoPhase[]): number {
  let count = 0;
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === "pending" || task.status === "in_progress") count++;
    }
  }
  return count;
}

function buildReminderText(): string | null {
  const groups: string[] = [];
  for (const phase of rt.phases) {
    const open = phase.tasks.filter((t) => t.status === "pending" || t.status === "in_progress");
    if (open.length === 0) continue;
    const tasks = open.map((t) => `  - ${t.content}`).join("\n");
    groups.push(`- ${phase.name}\n${tasks}`);
  }
  if (groups.length === 0) return null;

  const flat = groups.join("\n");
  const incomplete = countIncomplete(rt.phases);
  const plural = incomplete === 1 ? "item is" : "items are";
  return [
    `<system-reminder>`,
    `You stopped with ${incomplete} incomplete todo ${plural}:`,
    flat,
    ``,
    `Please continue working on these tasks or mark them complete if finished.`,
    `(Reminder ${rt.reminderCount}/${MAX_REMINDERS})`,
    `</system-reminder>`,
  ].join("\n");
}
