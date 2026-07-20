// ============================================================
// Todo — todo_list tool + inline panel widget (adapter).
//
// The model rewrites the whole list per update (Kimi Code semantics);
// the panel above the editor shows the folded view
// (selectVisibleTodos) and ctrl+t toggles expanded/collapsed. State
// persists to session entries so the panel survives hot-reload.
// ============================================================

import {
  type TodoItem,
  normalizeTodos,
  summarizeTodos,
  selectVisibleTodos,
  TODO_ENTRY_TYPE,
} from "../packages/core/todo/types";

interface TodoRuntime {
  todos: TodoItem[];
  expanded: boolean;
  appendEntry: ((type: string, data: any) => void) | null;
  ctx: any;
}

const rt: TodoRuntime = {
  todos: [],
  expanded: false,
  appendEntry: null,
  ctx: null,
};

// ── Rendering ─────────────────────────────────────────────────

function statusLine(t: TodoItem, theme: any): string {
  if (t.status === "in_progress") return theme.fg("accent", theme.bold("● ")) + theme.fg("text", t.title);
  if (t.status === "done") return theme.fg("success", "✓ ") + theme.fg("dim", t.title);
  return theme.fg("dim", "○ ") + theme.fg("dim", t.title);
}

function buildWidgetLines(theme: any): string[] | undefined {
  if (rt.todos.length === 0) return undefined;
  const counts = summarizeTodos(rt.todos);
  const head = theme.fg("dim", `─ todo (${counts.in_progress} active · ${counts.pending} pending · ${counts.done} done) ─`);
  if (rt.expanded) {
    return [head, ...rt.todos.map((t) => statusLine(t, theme)), theme.fg("dim", "ctrl+t collapse")];
  }
  const { rows, hidden, hiddenCounts } = selectVisibleTodos(rt.todos);
  const lines = [head, ...rows.map((t) => statusLine(t, theme))];
  if (hidden > 0) {
    lines.push(theme.fg("dim", `… +${hidden} more (${hiddenCounts.done} done · ${hiddenCounts.in_progress} in progress) · ctrl+t expand`));
  }
  return lines;
}

function refreshWidget(): void {
  const ctx = rt.ctx;
  if (!ctx?.hasUI) return;
  try {
    ctx.ui.setWidget("muselinn-todo", buildWidgetLines(ctx.ui.theme), { placement: "aboveEditor" });
  } catch { /* stale ctx */ }
}

// ── Persistence ───────────────────────────────────────────────

function persist(): void {
  if (!rt.appendEntry) return;
  try { rt.appendEntry(TODO_ENTRY_TYPE, { todos: rt.todos }); } catch { /* stale ctx */ }
}

/** Restore the latest persisted list from session entries.
 *  No matching entry means a fresh session — the panel resets. */
export function restoreTodos(entries: any[]): void {
  rt.todos = [];
  for (let i = (entries?.length ?? 0) - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type === "custom" && e.customType === TODO_ENTRY_TYPE && Array.isArray(e.data?.todos)) {
      rt.todos = e.data.todos.filter((t: any) => t && typeof t.title === "string");
      return;
    }
  }
}

// ── Session wiring ────────────────────────────────────────────

export function bindTodoSession(ctx: any, appendEntry: (type: string, data: any) => void): void {
  rt.ctx = ctx;
  rt.appendEntry = appendEntry;
  refreshWidget();
}

export function clearTodoSession(): void {
  rt.ctx = null;
  rt.appendEntry = null;
}

// ── Tool registration ─────────────────────────────────────────

export function registerTodoList(pi: any): void {
  pi.registerTool({
    name: "todo_list",
    label: "Todo List",
    promptSnippet: "todo_list: track your own task plan (update / read / clear)",
    promptGuidelines: [
      "Use todo_list action=update with the FULL rewritten list to plan multi-step work and keep it current",
      "Mark exactly one item in_progress at a time; mark items done as soon as they finish",
      "The list is shown to the user inline — write titles for the user, not for yourself",
    ],
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "update | read | clear" },
        todos: {
          type: "array",
          description: "For update: the full new list, [{id?, title, status: pending|in_progress|done}]",
          items: { type: "object" },
        },
      },
      required: ["action"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const action = String(params?.action ?? "");
      if (action === "update") {
        try {
          rt.todos = normalizeTodos(params.todos);
        } catch (err: any) {
          return { content: [{ type: "text", text: err?.message ?? String(err) }] };
        }
        persist();
        refreshWidget();
        const c = summarizeTodos(rt.todos);
        return { content: [{ type: "text", text: `todo updated: ${c.in_progress} in progress · ${c.pending} pending · ${c.done} done (${rt.todos.length} total)` }] };
      }
      if (action === "clear") {
        rt.todos = [];
        persist();
        refreshWidget();
        return { content: [{ type: "text", text: "todo list cleared" }] };
      }
      if (action === "read") {
        if (rt.todos.length === 0) return { content: [{ type: "text", text: "(todo list is empty)" }] };
        const lines = rt.todos.map((t) => `- [${t.status}] ${t.title} (${t.id})`);
        return { content: [{ type: "text", text: lines.join("\n") }] };
      }
      return { content: [{ type: "text", text: `todo_list: unknown action "${action}" (expected update|read|clear)` }] };
    },
  });

  // ctrl+t toggles the panel's expanded view.
  pi.registerShortcut("ctrl+t", {
    description: "Expand/collapse the todo panel",
    handler: () => {
      if (rt.todos.length === 0) return;
      rt.expanded = !rt.expanded;
      refreshWidget();
    },
  });
}
