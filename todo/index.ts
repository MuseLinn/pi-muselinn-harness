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
  formatPhaseDisplayName,
  phaseRomanNumeral,
  TODO_ENTRY_TYPE,
  type PhaseCounts,
  todoSymbol,
  formatTodoLine,
  formatPhaseLine,
  formatPhaseSummaryLine,
  selectCollapsedPhaseTasks,

} from "../packages/core/todo/types";
import { swarmState } from "../packages/core/swarm/types";

// ── Platform-aware key label ───────────────────────────────────
const EXPAND_KEY = "/todo toggle";

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

function buildWidgetLines(theme: any): string[] | undefined {
  const { phases } = rt;
  const activeDescriptions = getActiveTodoDescriptions();
  if (phases.length === 0) return undefined;

  const counts = summarizePhases(phases);
  const lines: string[] = [];

  // Header
  const head = theme.fg("dim", `─ todo (${counts.in_progress} active · ${counts.pending} pending · ${counts.completed} done) ─`);
  lines.push(head);

  // All done → minimal summary + "clear" hint
  const allDone = counts.pending === 0 && counts.in_progress === 0;
  if (allDone && !rt.expanded) {
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      lines.push(formatPhaseSummaryLine(phase, i + 1, phases.length > 1, theme));
    }
    lines.push(theme.fg("dim", `${EXPAND_KEY} expand · /todo rm to clear`));
    return lines;
  }

  const multi = phases.length > 1;

  if (rt.expanded) {
    // Expanded: show all phases with all tasks
    for (let i = 0; i < phases.length; i++) {
      const phase = phases[i];
      lines.push(formatPhaseLine(phase, i + 1, multi, theme));
      for (const task of phase.tasks) {
        const notesCount = task.notes?.length ?? 0;
        const agentMatch = task.status === "pending" && todoMatchesAnyDescription(task.content, activeDescriptions);
        const line = formatTodoLine(task, theme, notesCount, agentMatch);
        lines.push(`  ${line}`);
      }
    }
    lines.push(theme.fg("dim", `${EXPAND_KEY} collapse`));
  } else {
    // Collapsed: only the active phase shows tasks; others → one-line summary
    let activePhaseIdx = -1;
    for (let i = 0; i < phases.length; i++) {
      if (phases[i].tasks.some((t) => t.status === "in_progress")) {
        activePhaseIdx = i;
        break;
      }
    }
    if (activePhaseIdx === -1) {
      // No in_progress → first phase with pending is active
      for (let i = 0; i < phases.length; i++) {
        if (phases[i].tasks.some((t) => t.status === "pending")) {
          activePhaseIdx = i;
          break;
        }
      }
    }

    for (let i = 0; i < phases.length; i++) {
      if (i !== activePhaseIdx) {
        // Collapsed: one-line summary
        lines.push(formatPhaseSummaryLine(phases[i], i + 1, multi, theme));
        continue;
      }
      // Active phase: show header + smart viewport
      const phase = phases[i];
      lines.push(formatPhaseLine(phase, i + 1, multi, theme));
      const isMatched = (t: TodoItem) => t.status === "pending" && todoMatchesAnyDescription(t.content, activeDescriptions);
      const { items, summary } = selectCollapsedPhaseTasks(phase.tasks, isMatched);
      for (const task of items) {
        const notesCount = task.notes?.length ?? 0;
        const agentMatch = task.status === "pending" && todoMatchesAnyDescription(task.content, activeDescriptions);
        const line = formatTodoLine(task, theme, notesCount, agentMatch);
        lines.push(`  ${line}`);
      }
      if (summary) {
        lines.push(theme.fg("dim", `  ${summary}`));
      }
    }
    lines.push(theme.fg("dim", `${EXPAND_KEY} expand`));
  }

  return lines;
}

export function refreshWidget(): void {
  const ctx = rt.ctx;
  if (!ctx?.ui?.setWidget) return;
  if (rt.phases.length === 0) {
    ctx.ui.setWidget("todo", undefined);
    return;
  }
  const theme = ctx.ui?.theme || {};
  ctx.ui.setWidget("todo", buildWidgetLines(theme));
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
        },
        notes: {
          type: "array",
          items: { type: "string" },
          description: "Notes to attach (for add_notes op)",
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

  // ${EXPAND_KEY} toggles the panel's expanded view (ctrl+t is pi built-in thinking toggle).

  // Wire default subagent descriptions provider to swarm state
  setActiveTodoDescriptionsProvider(() => {
    const tasks = swarmState.currentSwarm?.tasks;
    if (!tasks) return [];
    return tasks
      .filter((t) => t.status === "running" || t.status === "pending")
      .map((t) => t.task ?? t.description ?? "")
      .filter(Boolean);
  });
  pi.on("tool_result", () => { refreshWidget(); });
  pi.on("agent_start", () => { refreshWidget(); });
  pi.on("agent_end", () => { refreshWidget(); });
}

// ── Toggle command ────────────────────────────────────────────

/**
 * Register the /todo toggle command.
 * Called from index.ts alongside registerTodoList.
 */
export function togglePanel(): void {
  if (rt.phases.length === 0) return;
  rt.expanded = !rt.expanded;
  refreshWidget();
}

// ── Reminder system ────────────────────────────────────────────

const MID_RUN_NUDGE_THRESHOLD = 8; // mutations without todo touch → nudge
const EAGER_PROMPT_SEEN_KEY = "muselinn_todo_eager_seen";

/**
 * Register todo reminder hooks on the pi object.
 *
 * Three reminder layers (matching oh-my-pi):
 *
 * 1. Eager prompt — when no todo exists, suggest the agent create one.
 * 2. Mid-run nudge — when todos exist but the agent hasn't called
 *    todo_list recently, a gentle "don't forget to update" nudge.
 * 3. Stop reminder — when the agent stopped with incomplete items.
 *
 * Plus goal-todo context when a goal is active and todos exist.
 */
export function registerTodoReminders(pi: any): void {
  // Track tool_result for `todo` tool to reset reminder state
  pi.on("tool_result", (event: any) => {
    if (event?.toolName === "todo_list") {
      rt.reminderCount = 0;
      rt.awaitingProgress = false;
      rt.reminderPending = false;
      rt.mutationsSinceLastTodoTouch = 0;
      return;
    }
    // Count mutations for mid-run nudge
    if (event?.isError === false) {
      rt.mutationsSinceLastTodoTouch = (rt.mutationsSinceLastTodoTouch || 0) + 1;
    }
  });

  // context: inject system-reminders for all three layers
  pi.on("context", (event: any) => {
    if (!event.messages) return;

    // Helpers to inject a block into the system message
    const inject = (text: string) => {
      const sysMsg = event.messages.find((m: any) => m.role === "system");
      const block = { type: "text", text };
      if (sysMsg) {
        sysMsg.content = Array.isArray(sysMsg.content)
          ? [...sysMsg.content, block]
          : [{ type: "text", text: sysMsg.content }, block];
      } else {
        event.messages.unshift({ role: "system", content: [block] });
      }
    };

    // ── Layer 1: Eager prompt ──
    if (rt.phases.length === 0) {
      // Only suggest once per session so we don't spam every turn
      const seen = (rt as any)[EAGER_PROMPT_SEEN_KEY];
      if (!seen) {
        (rt as any)[EAGER_PROMPT_SEEN_KEY] = true;
        inject([
          `<system-reminder>`,
          `Consider calling \`todo_list\` first to lay out a phased plan with a single \`init\` op. A good list covers the whole request — investigation through implementation and verification — not just the next step, with specific task descriptions a future turn could execute without re-planning.`,
          `A useful list keeps each task to a concise 5-10 word label.`,
          `If you create the list, continue the request in the same turn and avoid re-calling \`todo_list\` unless task state materially changes.`,
          `</system-reminder>`,
        ].join("\n"));
      }
    }

    // ── Layer 2: Mid-run nudge ──
    if (
      rt.phases.length > 0 &&
      !rt.reminderPending &&
      rt.mutationsSinceLastTodoTouch >= MID_RUN_NUDGE_THRESHOLD
    ) {
      rt.mutationsSinceLastTodoTouch = 0; // reset after nudge
      const incomplete = countIncomplete(rt.phases);
      if (incomplete > 0) {
        const plural = incomplete === 1 ? "is" : "are";
        inject([
          `<system-reminder>`,
          `Gentle reminder: ${incomplete} todo item${plural === "is" ? "" : "s"} ${plural} still open. If you finished a task since the last \`todo_list\` update, mark it done now so progress stays visible; otherwise just keep working.`,
          `</system-reminder>`,
        ].join("\n"));
      }
    }

    // ── Layer 3: Stop reminder ──
    if (rt.reminderPending) {
      rt.reminderPending = false;
      rt.awaitingProgress = true;
      rt.mutationsSinceLastTodoTouch = 0;

      const text = buildReminderText();
      if (text) inject(text);
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
