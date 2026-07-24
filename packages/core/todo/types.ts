// ============================================================
// Todo — phased task model + mutation helpers (pure, no host imports).
//
// Ported from oh-my-pi's todo.ts (phase model with ops), adapted
// for the pi-muselinn-harness extension tool surface.
// ============================================================

export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned";
export type TodoOperation = "init" | "start" | "done" | "rm" | "drop" | "append" | "add_notes" | "view";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  details?: string;
  notes?: string[];
}

export interface TodoPhase {
  name: string;
  tasks: TodoItem[];
}

export interface InitListEntry {
  phase: string;
  items: string[];
}

export interface TodoCompletionTransition {
  content: string;
  phase: string;
}

export interface VisibleTodos {
  rows: TodoItem[];
  hidden: number;
  hiddenCounts: Record<TodoStatus, number>;
}

export type TodoOpParams = {
  op: TodoOperation;
  list?: InitListEntry[];
  task?: string;
  phase?: string;
  notes?: string[];
  details?: string;
  items?: string[];
};

export const MAX_VISIBLE_TODOS = 5;
export const TODO_ENTRY_TYPE = "muselinn_todo";
const DEFAULT_INIT_PHASE = "Tasks";
const MAX_ITEMS = 50;

const VALID_STATUS: readonly TodoStatus[] = ["pending", "in_progress", "completed", "abandoned"];

// ── Helpers ────────────────────────────────────────────────────

export function findTaskByContent(
  phases: TodoPhase[],
  content: string,
): { task: TodoItem; phase: TodoPhase } | undefined {
  for (const phase of phases) {
    const task = phase.tasks.find((t) => t.content === content);
    if (task) return { task, phase };
  }
  return undefined;
}

export function findPhaseByName(phases: TodoPhase[], name: string): TodoPhase | undefined {
  return phases.find((p) => p.name === name);
}

export function cloneTask(task: TodoItem): TodoItem {
  return {
    content: task.content,
    status: task.status,
    ...(task.details !== undefined ? { details: task.details } : {}),
    ...(task.notes !== undefined ? { notes: [...task.notes] } : {}),
  };
}

export function clonePhases(phases: TodoPhase[]): TodoPhase[] {
  return phases.map((p) => ({ name: p.name, tasks: p.tasks.map(cloneTask) }));
}

function todoTransitionKey(phase: string, content: string): string {
  return `${phase}\u0000${content}`;
}

export function getCompletionTransitions(
  previous: TodoPhase[],
  updated: TodoPhase[],
): TodoCompletionTransition[] {
  const prev = new Set<string>();
  for (const phase of previous) {
    for (const task of phase.tasks) {
      if (task.status === "completed" || task.status === "abandoned") {
        prev.add(todoTransitionKey(phase.name, task.content));
      }
    }
  }
  const result: TodoCompletionTransition[] = [];
  for (const phase of updated) {
    for (const task of phase.tasks) {
      const key = todoTransitionKey(phase.name, task.content);
      if ((task.status === "completed" || task.status === "abandoned") && !prev.has(key)) {
        result.push({ content: task.content, phase: phase.name });
      }
    }
  }
  return result;
}

/** Ensure at most one task is in_progress (the earliest pending or in_progress). */
export function normalizeInProgressTask(phases: TodoPhase[]): void {
  let found = false;
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === "in_progress") {
        if (found) { task.status = "pending"; }
        else { found = true; }
      }
    }
  }
  if (!found) {
    for (const phase of phases) {
      for (const task of phase.tasks) {
        if (task.status === "pending") {
          task.status = "in_progress";
          return;
        }
      }
    }
  }
}

/** Return the first pending or in_progress task across all phases. */
export function nextActionableTask(phases: readonly TodoPhase[]): TodoItem | undefined {
  for (const phase of phases) {
    for (const task of phase.tasks) {
      if (task.status === "pending" || task.status === "in_progress") return task;
    }
  }
  return undefined;
}

// ── Operation helpers ──────────────────────────────────────────

function initPhases(entry: TodoOpParams, errors: string[]): TodoPhase[] {
  const list =
    entry.list ??
    (entry.items && entry.items.length > 0
      ? [{ phase: entry.phase ?? DEFAULT_INIT_PHASE, items: entry.items }]
      : undefined);
  if (!list) {
    errors.push("Missing list for init operation");
    return [];
  }
  if (list.length > 20) {
    errors.push("Too many phases (max 20)");
    return [];
  }
  const seenPhases = new Set<string>();
  const seenTasks = new Set<string>();
  for (const entry of list) {
    if (seenPhases.has(entry.phase)) {
      errors.push(`Duplicate phase "${entry.phase}" in init list`);
    }
    seenPhases.add(entry.phase);
    for (const content of entry.items) {
      if (!content || !content.trim()) {
        errors.push("Empty task content in init list");
        continue;
      }
      if (seenTasks.has(content)) {
        errors.push(`Duplicate task "${content}" in init list`);
      }
      seenTasks.add(content);
    }
  }
  if (errors.length > 0) return [];
  return list.map((entry) => ({
    name: entry.phase,
    tasks: entry.items
      .filter((c) => c && c.trim())
      .map<TodoItem>((content) => ({ content: content.trim(), status: "pending" })),
  }));
}

function appendItems(phases: TodoPhase[], entry: TodoOpParams, errors: string[]): TodoPhase[] {
  if (!entry.phase) { errors.push("Missing phase name for append"); return phases; }
  if (!entry.items || entry.items.length === 0) { errors.push("No items to append"); return phases; }
  const clone = clonePhases(phases);
  let target = findPhaseByName(clone, entry.phase);
  if (!target) {
    target = { name: entry.phase, tasks: [] };
    clone.push(target);
  }
  const contents = target.tasks.map((t) => t.content);
  for (const item of entry.items) {
    if (!item || !item.trim()) { errors.push("Empty task content in append"); continue; }
    if (contents.includes(item.trim())) { errors.push(`Duplicate task "${item.trim()}"`); continue; }
    target.tasks.push({ content: item.trim(), status: "pending" });
    contents.push(item.trim());
  }
  return clone;
}

function resolveTaskOrError(
  phases: TodoPhase[],
  content: string | undefined,
  errors: string[],
): { task: TodoItem; phase: TodoPhase } | undefined {
  if (!content || !content.trim()) { errors.push("Missing task content"); return undefined; }
  const found = findTaskByContent(phases, content);
  if (!found) { errors.push(`Task "${content}" not found`); return undefined; }
  return found;
}

function resolvePhaseOrError(
  phases: TodoPhase[],
  name: string | undefined,
  errors: string[],
): TodoPhase | undefined {
  if (!name || !name.trim()) { errors.push("Missing phase name"); return undefined; }
  const found = findPhaseByName(phases, name);
  if (!found) { errors.push(`Phase "${name}" not found`); return undefined; }
  return found;
}

function removeTasks(phases: TodoPhase[], entry: TodoOpParams, errors: string[]): TodoPhase[] {
  const clone = clonePhases(phases);
  if (entry.task) {
    const resolved = resolveTaskOrError(clone, entry.task, errors);
    if (!resolved) return phases;
    resolved.phase.tasks = resolved.phase.tasks.filter((t) => t !== resolved.task);
  } else if (entry.phase) {
    const resolved = resolvePhaseOrError(clone, entry.phase, errors);
    if (!resolved) return phases;
    resolved.tasks = [];
  } else {
    // Neither task nor phase → remove all
    return [];
  }
  // Prune empty phases
  return clone.filter((p) => p.tasks.length > 0);
}

function markTasks(
  phases: TodoPhase[],
  entry: TodoOpParams,
  targetStatus: TodoStatus,
  errors: string[],
): TodoPhase[] {
  const clone = clonePhases(phases);
  if (entry.task) {
    const resolved = resolveTaskOrError(clone, entry.task, errors);
    if (!resolved) return phases;
    resolved.task.status = targetStatus;
  } else if (entry.phase) {
    const resolved = resolvePhaseOrError(clone, entry.phase, errors);
    if (!resolved) return phases;
    for (const task of resolved.tasks) {
      if (task.status === "pending" || task.status === "in_progress") {
        task.status = targetStatus;
      }
    }
  } else {
    // Neither → mark all open tasks
    for (const phase of clone) {
      for (const task of phase.tasks) {
        if (task.status === "pending" || task.status === "in_progress") {
          task.status = targetStatus;
        }
      }
    }
  }
  return clone;
}

function applyEntry(phases: TodoPhase[], entry: TodoOpParams, errors: string[]): TodoPhase[] {
  switch (entry.op) {
    case "init":
      return initPhases(entry, errors);
    case "start": {
      if (!entry.task) { errors.push("Missing task content for start"); return phases; }
      const deEscalated = clonePhases(phases);
      for (const p of deEscalated) {
        for (const t of p.tasks) {
          if (t.status === "in_progress") t.status = "pending";
        }
      }
      const resolved = findTaskByContent(deEscalated, entry.task);
      if (!resolved) { errors.push(`Task "${entry.task}" not found`); return phases; }
      resolved.task.status = "in_progress";
      return deEscalated;
    }
    case "done":
      return markTasks(phases, entry, "completed", errors);
    case "drop":
      return markTasks(phases, entry, "abandoned", errors);
    case "rm":
      return removeTasks(phases, entry, errors);
    case "append":
      return appendItems(phases, entry, errors);
    case "add_notes": {
      if (!entry.task) { errors.push("Missing task content for add_notes"); return phases; }
      if (!entry.notes || entry.notes.length === 0) { errors.push("No notes to add"); return phases; }
      const resolved = findTaskByContent(phases, entry.task);
      if (!resolved) { errors.push(`Task "${entry.task}" not found`); return phases; }
      const clone = clonePhases(phases);
      const t = findTaskByContent(clone, entry.task);
      if (t) {
        t.task.notes = [...(t.task.notes || []), ...entry.notes];
      }
      return clone;
    }
    case "view":
      return clonePhases(phases);
    default:
      errors.push(`Unknown operation: ${entry.op}`);
      return phases;
  }
}

export function applyOpsToPhases(
  currentPhases: TodoPhase[],
  ops: TodoOpParams[],
): { phases: TodoPhase[]; errors: string[] } {
  const errors: string[] = [];
  let next = clonePhases(currentPhases);
  for (const op of ops) {
    const before = clonePhases(next);
    next = applyEntry(next, op, errors);
    if (errors.length > 0) {
      // Roll back on first error
      return { phases: currentPhases, errors };
    }
  }
  normalizeInProgressTask(next);
  return { phases: next, errors };
  completed: number;
}

/**
 * Normalize a single op (the most common path) into applyOpsToPhases.
 */
export function applyOp(
  currentPhases: TodoPhase[],
  op: TodoOpParams,
): { phases: TodoPhase[]; errors: string[] } {
  return applyOpsToPhases(currentPhases, [op]);
}

// ── Counts ─────────────────────────────────────────────────────

export interface PhaseCounts {
  completed: number;
  in_progress: number;
  pending: number;
  abandoned: number;
}

export function summarizePhases(phases: readonly TodoPhase[]): PhaseCounts {
  const counts: PhaseCounts = { completed: 0, in_progress: 0, pending: 0, abandoned: 0 };
  for (const phase of phases) {
    for (const task of phase.tasks) {
      counts[task.status] += 1;
    }
  }
  return counts;
}

export function summarizeTodos(todos: readonly TodoItem[]): Record<TodoStatus, number> {
  const counts: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0, abandoned: 0 };
  for (const t of todos) counts[t.status] += 1;
  return counts;
}

// ── Text output ────────────────────────────────────────────────

export function formatSummary(phases: TodoPhase[], errors: string[], readOnly = false): string {
  const tasks = phases.flatMap((p) => p.tasks);
  if (tasks.length === 0) {
    if (errors.length > 0) return `Errors: ${errors.join("; ")}`;
    return readOnly ? "Todo list is empty." : "Todo list cleared.";
  }

  const remainingByPhase = phases
    .map((p) => ({
      name: p.name,
      tasks: p.tasks.filter((t) => t.status === "pending" || t.status === "in_progress"),
    }))
    .filter((p) => p.tasks.length > 0);

  const closedAll = tasks.filter((t) => t.status === "completed" || t.status === "abandoned").length;
  const remainingTasks = remainingByPhase.flatMap((p) => p.tasks.map((t) => ({ ...t, phase: p.name })));

  let currentIdx = phases.findIndex((p) =>
    p.tasks.some((t) => t.status === "pending" || t.status === "in_progress"),
  );
  if (currentIdx === -1) currentIdx = phases.length - 1;
  const current = phases[currentIdx];
  const done = current.tasks.filter((t) => t.status === "completed" || t.status === "abandoned").length;

  const lines: string[] = [];
  if (errors.length > 0) lines.push(`Errors: ${errors.join("; ")}`);
  if (remainingTasks.length === 0) {
    lines.push("Remaining items: none.");
  } else {
    lines.push(`Remaining items (${remainingTasks.length}):`);
    for (const task of remainingTasks) {
      lines.push(`  - ${task.content} [${task.status}] (${task.phase})`);
    }
  }
  lines.push(`Overall: ${closedAll}/${tasks.length} done, ${remainingTasks.length} open.`);
  lines.push(
    `Active phase ${currentIdx + 1}/${phases.length} "${current.name}" (${done}/${current.tasks.length}).`,
  );
  for (const phase of phases) {
    lines.push(`  ${phase.name}:`);
    for (const task of phase.tasks) {
      const checkbox =
        task.status === "completed" ? "[X]" :
        task.status === "abandoned" ? "[-]" :
        task.status === "in_progress" ? "[/]" :
        "[ ]";
      const tag =
        task.status === "in_progress" ? " (in progress)" :
        task.status === "abandoned" ? " (dropped)" :
        "";
      lines.push(`    - ${checkbox} ${task.content}${tag}`);
    }
  }
  return lines.join("\n");
}

// ── Markdown round-trip (for /todo command) ────────────────────

const STATUS_TO_MARKER: Record<TodoStatus, string> = {
  pending: "[ ]",
  in_progress: "[/]",
  completed: "[x]",
  abandoned: "[-]",
};

const MARKER_TO_STATUS: Record<string, TodoStatus> = {
  "[ ]": "pending",
  "[/]": "in_progress",
  "[x]": "completed",
  "[X]": "completed",
  "[-]": "abandoned",
};

export function phasesToMarkdown(phases: TodoPhase[]): string {
  const lines: string[] = [];
  for (const phase of phases) {
    if (phase.tasks.length === 0) continue;
    lines.push(`# ${phase.name}`);
    for (const task of phase.tasks) {
      lines.push(`- ${STATUS_TO_MARKER[task.status]} ${task.content}`);
    }
  }
  return lines.join("\n");
}

export function markdownToPhases(md: string): { phases: TodoPhase[]; errors: string[] } {
  const errors: string[] = [];
  const phases: TodoPhase[] = [];
  let currentName = DEFAULT_INIT_PHASE;
  let current: TodoItem[] = [];
  const seenTasks = new Set<string>();

  const flush = () => {
    if (current.length > 0) {
      phases.push({ name: currentName, tasks: current });
      current = [];
      seenTasks.clear();
    }
  };

  for (const line of md.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Phase heading
    if (trimmed.startsWith("# ")) {
      flush();
      currentName = trimmed.slice(2).trim() || DEFAULT_INIT_PHASE;
      continue;
    }
    // Checklist item
    const markerMatch = trimmed.match(/^-\s+(\[.\])/);
    if (markerMatch) {
      const marker = markerMatch[1];
      const rest = trimmed.slice(markerMatch[0].length).trim();
      const status = MARKER_TO_STATUS[marker] ?? "pending";
      if (!rest) { errors.push("Empty task content in markdown"); continue; }
      if (seenTasks.has(rest)) { errors.push(`Duplicate task "${rest}"`); continue; }
      seenTasks.add(rest);
      current.push({ content: rest, status });
      continue;
    }
    // Plain list item (treat as pending)
    const listMatch = trimmed.match(/^-\s+(.+)/);
    if (listMatch) {
      const rest = listMatch[1].trim();
      if (!rest) continue;
      if (seenTasks.has(rest)) { errors.push(`Duplicate task "${rest}"`); continue; }
      seenTasks.add(rest);
      current.push({ content: rest, status: "pending" });
    }
  }
  flush();
  return { phases, errors };
}

// ── Display helpers (roman numerals) ───────────────────────────

const ROMAN_PAIRS: Array<[number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

/**
 * One-based ASCII roman numeral (I, II, III, IV, …).
 */
export function phaseRomanNumeral(oneBasedIndex: number): string {
  if (oneBasedIndex < 1 || oneBasedIndex > 100) return String(oneBasedIndex);
  let out = "";
  let rem = oneBasedIndex;
  for (const [value, symbol] of ROMAN_PAIRS) {
    while (rem >= value) {
      out += symbol;
      rem -= value;
    }
  }
  return out;
}

/** Display-only phase header: `I. Foundation`. State never sees this. */
export function formatPhaseDisplayName(name: string, oneBasedIndex: number): string {
  return `${phaseRomanNumeral(oneBasedIndex)}. ${name}`;
}

// ── Widget selection helpers ───────────────────────────────────

/**
 * Fold the list to at most maxVisible rows: in_progress first,
 * then earliest pending, keeping one slot for the most recent done.
 * Updated for phase model: flattens all phases.
 */
export function selectVisibleTodos(
  phases: readonly TodoPhase[],
  maxVisible: number = MAX_VISIBLE_TODOS,
): VisibleTodos {
  const todos = phases.flatMap((p) => p.tasks);
  if (todos.length <= maxVisible) {
    return { rows: [...todos], hidden: 0, hiddenCounts: { pending: 0, in_progress: 0, completed: 0, abandoned: 0 } };
  }

  const inProgress: number[] = [];
  const pending: number[] = [];
  const done: number[] = [];
  const abandoned: number[] = [];

  for (const [i, todo] of todos.entries()) {
    if (todo.status === "in_progress") inProgress.push(i);
    else if (todo.status === "pending") pending.push(i);
    else if (todo.status === "completed") done.push(i);
    else abandoned.push(i);
  }

  const picked = new Set<number>();
  const add = (indices: number[], count: number) => {
    for (const i of indices) {
      if (count <= 0) break;
      picked.add(i);
      count--;
    }
  };

  // All in_progress first
  add(inProgress, inProgress.length);
  const remaining = maxVisible - picked.size;

  if (remaining > 0) {
    // Then earliest pending
    add(pending, remaining);
  }
  const remaining2 = maxVisible - picked.size;
  if (remaining2 > 0) {
    // Keep one slot for the most recent done
    const doneToShow = done.slice(-remaining2);
    add(doneToShow, doneToShow.length);
  }
  const remaining3 = maxVisible - picked.size;
  if (remaining3 > 0) {
    // Fill with abandoned from end
    const abandonedToShow = abandoned.slice(-remaining3);
    add(abandonedToShow, abandonedToShow.length);
  }

  const rows: TodoItem[] = [];
  for (const [i, todo] of todos.entries()) {
    if (picked.has(i)) rows.push(todo);
  }

  const hiddenCounts: Record<TodoStatus, number> = { pending: 0, in_progress: 0, completed: 0, abandoned: 0 };
  for (const [i, todo] of todos.entries()) {
    if (!picked.has(i)) hiddenCounts[todo.status] += 1;
  }
  const hidden = todos.length - rows.length;

  return { rows, hidden, hiddenCounts };
}

// ── Subagent task matching ───────────────────────────────────

const TODO_DESCRIPTION_MIN_OVERLAP = 6;

function normalizeForTodoMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u00C0-\u024F\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF]+/g, " ").trim();
}

export function todoMatchesAnyDescription(content: string, descriptions: readonly string[]): boolean {
  if (descriptions.length === 0) return false;
  const normalContent = normalizeForTodoMatch(content);
  for (const desc of descriptions) {
    const normalDesc = normalizeForTodoMatch(desc);
    if (normalDesc === normalContent) return true;
    // Substring fallback with minimum overlap
    if (normalDesc.length >= TODO_DESCRIPTION_MIN_OVERLAP && normalContent.length >= TODO_DESCRIPTION_MIN_OVERLAP) {
      // Exact substring check
      if (normalDesc.includes(normalContent) || normalContent.includes(normalDesc)) {
        return true;
      }
    }
  }
  return false;
}

export type TodoActiveDescriptionsProvider = () => readonly string[];
let activeTodoDescriptions: TodoActiveDescriptionsProvider = () => [];

export function setActiveTodoDescriptionsProvider(provider: TodoActiveDescriptionsProvider): void {
  activeTodoDescriptions = provider;
}

export function getActiveTodoDescriptions(): readonly string[] {
  return activeTodoDescriptions();
}
