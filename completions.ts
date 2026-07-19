// ============================================================
// Shared slash-command argument completion builders.
// Pure module — no pi / pi-tui imports, so unit tests can load it
// directly through the jiti CJS loader. Command modules wire these
// into pi.registerCommand({ getArgumentCompletions }).
//
// Semantics (modeled on pi-cache-graph):
//   - prefix filter (case-insensitive startsWith)
//   - empty prefix        → full list
//   - no prefix matches   → full list (fallback, never an empty list)
//
// pi calls getArgumentCompletions(argumentText) where argumentText is
// EVERYTHING after the first space (e.g. "/goal budget 10 t" →
// "budget 10 t"), and replaces the whole argumentText with the picked
// item's value — so multi-token completions must return the full
// argument string as `value`.
// ============================================================

export interface CompletionItem {
  value: string;
  label: string;
  description?: string;
}

/**
 * Prefix-filter completion items. Empty prefix returns all items;
 * a prefix with no matches falls back to the full list.
 */
export function filterCompletions<T extends CompletionItem>(
  items: readonly T[],
  prefix: string,
): T[] {
  const p = (prefix || "").trim().toLowerCase();
  if (!p) return [...items];
  const filtered = items.filter(
    (i) => i.value.toLowerCase().startsWith(p) || i.label.toLowerCase().startsWith(p),
  );
  return filtered.length > 0 ? filtered : [...items];
}

// ── /goal ─────────────────────────────────────────────────────

const GOAL_SUBCOMMANDS: CompletionItem[] = [
  { value: "pause", label: "pause", description: "Pause active goal" },
  { value: "resume", label: "resume", description: "Resume paused goal" },
  { value: "cancel", label: "cancel", description: "Cancel goal" },
  { value: "replace", label: "replace <new>", description: "Replace current goal" },
  { value: "next", label: "next", description: "Complete current goal" },
  { value: "status", label: "status", description: "Show goal status" },
  { value: "queue", label: "queue", description: "Show goal queue" },
  { value: "add", label: "add <objective>", description: "Add goal to queue" },
  { value: "prioritize", label: "prioritize <index>", description: "Move queued goal to front" },
  { value: "drop", label: "drop <index>", description: "Remove queued goal" },
  { value: "skip", label: "skip", description: "Skip to next queued goal" },
  { value: "budget", label: "budget <number> <unit>", description: "Set goal budget" },
];

// Units accepted by goal/types.ts parseBudgetToLimits + /goal budget handler.
const GOAL_BUDGET_UNITS: CompletionItem[] = [
  { value: "turns", label: "turns", description: "Budget in agent turns" },
  { value: "tokens", label: "tokens", description: "Budget in tokens" },
  { value: "ms", label: "ms", description: "Wall-clock budget in milliseconds" },
  { value: "s", label: "s", description: "Wall-clock budget in seconds" },
  { value: "minutes", label: "minutes", description: "Wall-clock budget in minutes" },
  { value: "hours", label: "hours", description: "Wall-clock budget in hours" },
];

/**
 * Argument completions for /goal.
 * - First token: subcommand list (prefix-filtered).
 * - `budget <number> <unit>`: third token completes budget units; the
 *   returned value is the FULL argument string (pi replaces the whole
 *   argumentText with item.value).
 */
export function goalArgumentCompletions(prefix: string): CompletionItem[] | null {
  const text = prefix || "";
  const endsWithSpace = /\s$/.test(text);
  const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0);

  // Completing the subcommand itself.
  if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) {
    return filterCompletions(GOAL_SUBCOMMANDS, tokens[0] ?? "");
  }

  const sub = tokens[0].toLowerCase();
  if (sub === "budget") {
    // tokens[1] is the number — no completion while it is being typed.
    if (tokens.length === 1) return null; // "budget " → need a number first
    if (tokens.length === 2 && !endsWithSpace) return null; // typing the number
    if (tokens.length >= 3 && endsWithSpace) return null; // unit already done
    const unitPrefix = endsWithSpace ? "" : (tokens[2] ?? "");
    const base = `budget ${tokens[1]}`;
    const unitItems = GOAL_BUDGET_UNITS.map((u) => ({
      value: `${base} ${u.value}`,
      label: u.label,
      description: u.description,
    }));
    return filterCompletions(unitItems, unitPrefix);
  }

  return null;
}

// ── /swarm ────────────────────────────────────────────────────

const SWARM_SUBCOMMANDS: CompletionItem[] = [
  { value: "on", label: "on", description: "Turn swarm mode ON" },
  { value: "off", label: "off", description: "Turn swarm mode OFF" },
  { value: "status", label: "status", description: "Show swarm mode + resume status" },
];

export function swarmArgumentCompletions(prefix: string): CompletionItem[] | null {
  const text = prefix || "";
  if (/\s/.test(text.trim())) return null; // single-token command
  return filterCompletions(SWARM_SUBCOMMANDS, text);
}

// ── /plan ─────────────────────────────────────────────────────

const PLAN_SUBCOMMANDS: CompletionItem[] = [
  { value: "on", label: "on", description: "Enter plan mode" },
  { value: "off", label: "off", description: "Exit plan mode" },
  { value: "clear", label: "clear", description: "Clear plan content (keep mode state)" },
];

export function planArgumentCompletions(prefix: string): CompletionItem[] | null {
  const text = prefix || "";
  if (/\s/.test(text.trim())) return null;
  return filterCompletions(PLAN_SUBCOMMANDS, text);
}

// ── /tui ──────────────────────────────────────────────────────

const TUI_SUBCOMMANDS: CompletionItem[] = [
  { value: "style", label: "style <plain|boxed|compact>", description: "Editor chrome style" },
  { value: "math", label: "math <on|off>", description: "Render $$...$$ math via txm" },
  { value: "timing", label: "timing", description: "Render timing stats (PI_MUSELINN_HARNESS_TUI_TIMING=1)" },
];

const TUI_STYLES: CompletionItem[] = [
  { value: "plain", label: "plain", description: "Pi default borders" },
  { value: "boxed", label: "boxed", description: "Kimi-style closed box (╭╮│╰╯)" },
  { value: "compact", label: "compact", description: "pi-spark-style info top border" },
];

/**
 * Argument completions for /tui.
 * - First token: subcommand list (prefix-filtered).
 * - `style <name>`: second token completes style names; the returned
 *   value is the FULL argument string (pi replaces the whole
 *   argumentText with item.value).
 */
export function tuiArgumentCompletions(prefix: string): CompletionItem[] | null {
  const text = prefix || "";
  const endsWithSpace = /\s$/.test(text);
  const tokens = text.trim().split(/\s+/).filter((t) => t.length > 0);

  if (tokens.length === 0 || (tokens.length === 1 && !endsWithSpace)) {
    return filterCompletions(TUI_SUBCOMMANDS, tokens[0] ?? "");
  }

  if (tokens[0].toLowerCase() === "style") {
    if (tokens.length >= 2 && endsWithSpace) return null; // style already done
    const stylePrefix = tokens[1] ?? "";
    const styleItems = TUI_STYLES.map((s) => ({
      value: `style ${s.value}`,
      label: s.label,
      description: s.description,
    }));
    return filterCompletions(styleItems, stylePrefix);
  }

  if (tokens[0].toLowerCase() === "math") {
    if (tokens.length >= 2 && endsWithSpace) return null; // on/off already done
    const valuePrefix = tokens[1] ?? "";
    const valueItems = [
      { value: "math on", label: "on", description: "Render math via txm" },
      { value: "math off", label: "off", description: "Keep raw LaTeX" },
    ];
    return filterCompletions(valueItems, valuePrefix);
  }

  return null;
}

// ── /mode ─────────────────────────────────────────────────────

const MODE_SUBCOMMANDS: CompletionItem[] = [
  { value: "auto", label: "auto", description: "Auto-approve all (disable ask_user_question)" },
  { value: "yolo", label: "yolo", description: "Approve after safety checks" },
  { value: "manual", label: "manual", description: "Require approval for all actions" },
  { value: "status", label: "status", description: "Show current mode" },
];

export function modeArgumentCompletions(prefix: string): CompletionItem[] | null {
  const text = prefix || "";
  if (/\s/.test(text.trim())) return null;
  return filterCompletions(MODE_SUBCOMMANDS, text);
}
