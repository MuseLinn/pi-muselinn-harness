// ============================================================
// Todo — list model + visible-row selection (pure, no host imports).
//
// selectVisibleTodos is ported from Kimi Code's
// apps/kimi-code/src/tui/components/chrome/todo-panel.ts: all
// in_progress first, then earliest pending, but keep one slot for the
// most recent done — the agent's current focus stays visible even when
// the list is long.
//
// Upstream sync: verified with MoonshotAI/kimi-code main @ c5b6103b.
// ============================================================

export type TodoStatus = "pending" | "in_progress" | "done";

export interface TodoItem {
  id: string;
  title: string;
  status: TodoStatus;
}

export interface VisibleTodos {
  rows: TodoItem[];
  hidden: number;
  hiddenCounts: Record<TodoStatus, number>;
}

export const MAX_VISIBLE_TODOS = 5;
export const TODO_ENTRY_TYPE = "muselinn_todo";

const VALID_STATUS: readonly TodoStatus[] = ["pending", "in_progress", "done"];

/**
 * Normalize tool input into a clean TodoItem list. The model rewrites the
 * full list on every update (Kimi semantics): ids are preserved when
 * given, otherwise assigned as t1..tN in order. Throws on bad shape.
 */
export function normalizeTodos(input: any): TodoItem[] {
  if (!Array.isArray(input)) throw new Error('todo_list: "todos" must be an array');
  if (input.length > 50) throw new Error("todo_list: too many items (max 50)");
  const seen = new Set<string>();
  return input.map((raw: any, i: number) => {
    const title = typeof raw?.title === "string" ? raw.title.trim() : "";
    if (!title) throw new Error(`todo_list: item #${i + 1} has no title`);
    const status: TodoStatus = VALID_STATUS.includes(raw?.status) ? raw.status : "pending";
    let id = typeof raw?.id === "string" && raw.id.trim() ? raw.id.trim() : `t${i + 1}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return { id, title, status };
  });
}

/** Count items by status. */
export function summarizeTodos(todos: readonly TodoItem[]): Record<TodoStatus, number> {
  const counts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  for (const t of todos) counts[t.status] += 1;
  return counts;
}

/**
 * Fold the list to at most MAX_VISIBLE_TODOS rows: all in_progress first,
 * then earliest pending, keeping one slot for the most recent done.
 */
export function selectVisibleTodos(todos: readonly TodoItem[], maxVisible: number = MAX_VISIBLE_TODOS): VisibleTodos {
  if (todos.length <= maxVisible) {
    return { rows: [...todos], hidden: 0, hiddenCounts: { done: 0, in_progress: 0, pending: 0 } };
  }

  const inProgress: number[] = [];
  const pending: number[] = [];
  const done: number[] = [];
  todos.forEach((todo, i) => {
    if (todo.status === "in_progress") inProgress.push(i);
    else if (todo.status === "pending") pending.push(i);
    else done.push(i);
  });

  const picked = new Set<number>();
  for (const i of inProgress.slice(0, maxVisible)) picked.add(i);

  if (picked.size < MAX_VISIBLE_TODOS) {
    // Most recent done first; earliest pending first.
    const doneCandidates = [...done].reverse();
    const pendingCandidates = pending;

    const remaining = maxVisible - picked.size;
    let doneCount: number;
    let pendingCount: number;
    if (doneCandidates.length === 0) {
      doneCount = 0;
      pendingCount = Math.min(remaining, pendingCandidates.length);
    } else if (pendingCandidates.length === 0) {
      pendingCount = 0;
      doneCount = Math.min(remaining, doneCandidates.length);
    } else {
      doneCount = 1;
      pendingCount = Math.min(remaining - 1, pendingCandidates.length);
      if (pendingCount < remaining - 1) {
        doneCount = Math.min(doneCandidates.length, remaining - pendingCount);
      }
    }

    for (let i = 0; i < doneCount; i++) picked.add(doneCandidates[i]);
    for (let i = 0; i < pendingCount; i++) picked.add(pendingCandidates[i]);
  }

  const sortedIdx = [...picked].sort((a, b) => a - b);

  const hiddenCounts: Record<TodoStatus, number> = { done: 0, in_progress: 0, pending: 0 };
  todos.forEach((todo, i) => {
    if (!picked.has(i)) hiddenCounts[todo.status] += 1;
  });

  return {
    rows: sortedIdx.map((i) => todos[i]),
    hidden: todos.length - sortedIdx.length,
    hiddenCounts,
  };
}
