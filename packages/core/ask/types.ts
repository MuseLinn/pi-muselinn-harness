// ============================================================
// Ask — question spec, answer state machine + formatting (pure,
// no host imports, erasable-syntax only: tests import this file
// directly with node's type stripping).
//
// Shared by the ask_user_question tool and the permission approval
// dialog: one spec format, one per-question answer state machine,
// one answer formatter. The interactive component itself lives in
// the adapter (ask/dialog.ts, pi-tui).
// ============================================================

export interface OptionSpec {
  label: string;
  description?: string;
}

export interface QuestionSpec {
  question: string;
  /** Short tab label (≤ MAX_HEADER_LEN chars) for multi-question dialogs. */
  header?: string;
  options: OptionSpec[];
  /** Checkbox semantics: Space toggles, Enter confirms the question. */
  multiSelect?: boolean;
  /** Append a synthetic free-text "Other" option (ask tool default). */
  allowOther?: boolean;
}

/** Single-select answers are strings; multi-select answers are arrays. */
export type AnswerValue = string | string[];

export type AnswerStatus = "answered" | "skipped" | "cancelled";

export interface AnsweredQuestion {
  question: string;
  header?: string;
  /** Present iff status is "answered". */
  answer?: AnswerValue;
  /** Defaults to "cancelled" when answer is undefined (legacy callers). */
  status?: AnswerStatus;
}

/** Max options shown with digit shortcuts (1-9). */
export const MAX_DIGIT_OPTIONS = 9;

/** Max questions per ask_user_question call. */
export const MAX_QUESTIONS = 4;

/** Max length of a question header (tab label); longer ones are truncated. */
export const MAX_HEADER_LEN = 12;

/** Label of the synthetic free-text option appended when allowOther. */
export const OTHER_LABEL = "Other";

/**
 * Human action title for a tool name on the approval dialog
 * (Kimi approval-panel parity: "Run this command?" / "Apply these edits?").
 */
export function approvalTitleFor(toolName: string): string {
  switch (toolName) {
    case "bash": return "Run this command?";
    case "edit": return "Apply these edits?";
    case "write": return "Write this file?";
    case "read": return "Read this file?";
    case "grep": return "Search with this pattern?";
    case "find": return "Find files with this pattern?";
    case "ls": return "List this directory?";
    case "ask_user_question": return "Ask the user?";
    case "todo_list": return "Update the todo list?";
    case "cron_create": return "Schedule this cron task?";
    case "cron_delete": return "Delete this cron task?";
    default: return `Run ${toolName}?`;
  }
}

/**
 * Normalize tool input into QuestionSpec[]. Accepts the array form
 * ({ questions: [...] }) and the single-question shorthand
 * ({ question, options, header?, multi_select? }). Options accept
 * strings or {label, description}. Every produced spec gets
 * allowOther: true (the ask tool always offers a free-text Other;
 * the permission dialog builds literal specs without it).
 * Throws on structurally invalid input (the tool handler turns this
 * into a clear error result rather than a dialog).
 */
export function normalizeQuestions(input: any): QuestionSpec[] {
  const rawList = Array.isArray(input?.questions)
    ? input.questions
    : input?.question
      ? [input]
      : null;
  if (!rawList || rawList.length === 0) {
    throw new Error('ask_user_question: provide "question" + "options" (or a "questions" array)');
  }
  if (rawList.length > MAX_QUESTIONS) {
    throw new Error(`ask_user_question: at most ${MAX_QUESTIONS} questions per call (got ${rawList.length})`);
  }
  return rawList.map((q: any, qi: number) => {
    if (!q || typeof q.question !== "string" || q.question.trim() === "") {
      throw new Error(`ask_user_question: question #${qi + 1} has no text`);
    }
    const rawOpts = Array.isArray(q.options) ? q.options : [];
    if (rawOpts.length < 2) {
      throw new Error(`ask_user_question: question #${qi + 1} needs at least 2 options`);
    }
    const options: OptionSpec[] = rawOpts.map((o: any, oi: number) => {
      const label = typeof o === "string" ? o : o?.label;
      if (typeof label !== "string" || label.trim() === "") {
        throw new Error(`ask_user_question: option #${oi + 1} of question #${qi + 1} has no label`);
      }
      return { label, description: typeof o === "object" && o ? o.description : undefined };
    });
    let header: string | undefined;
    if (typeof q.header === "string" && q.header.trim() !== "") {
      header = q.header.trim().slice(0, MAX_HEADER_LEN);
    }
    return {
      question: q.question,
      header,
      options,
      multiSelect: q.multi_select === true || q.multiSelect === true,
      allowOther: true,
    };
  });
}

/** Digit key ("1".."9") → option index, or -1 when not applicable. */
export function digitToIndex(data: string, optionCount: number): number {
  if (data.length !== 1) return -1;
  const d = data.charCodeAt(0) - 49; // '1' → 0
  if (d < 0 || d >= Math.min(MAX_DIGIT_OPTIONS, optionCount)) return -1;
  return d;
}

/** Move the cursor within [0, optionCount). */
export function moveIndex(cur: number, delta: number, optionCount: number): number {
  if (optionCount <= 0) return 0;
  return Math.max(0, Math.min(optionCount - 1, cur + delta));
}

/** Result of activating/toggling an option, drives the dialog's next step. */
export type ActivateResult = "answered" | "toggled" | "edit-other" | "noop";

/**
 * Per-question answer state machine (pure — the pi-tui dialog is a
 * thin renderer/input-router over this). Covers single-select,
 * multi-select (checkbox) and the synthetic Other free-text option.
 */
export class AnswerState {
  readonly spec: QuestionSpec;
  cursor = 0;
  /** Single-select choice (option index; otherIndex = Other). */
  single: number | undefined = undefined;
  /** Multi-select choices. */
  readonly multi: Set<number> = new Set<number>();
  /** Committed Other free text ("" = none). */
  otherText = "";
  /** True while the Other free-text input owns the keyboard. */
  editingOther = false;

  constructor(spec: QuestionSpec) {
    this.spec = spec;
  }

  get optionCount(): number {
    return this.spec.options.length + (this.spec.allowOther ? 1 : 0);
  }

  get otherIndex(): number {
    return this.spec.options.length;
  }

  isOther(i: number): boolean {
    return this.spec.allowOther === true && i === this.otherIndex;
  }

  isSelected(i: number): boolean {
    return this.spec.multiSelect ? this.multi.has(i) : this.single === i;
  }

  moveCursor(delta: number): void {
    this.cursor = moveIndex(this.cursor, delta, this.optionCount);
  }

  /**
   * Enter / digit key on option i. Single-select: picks (Other enters
   * edit mode). Multi-select: toggles (Other enters edit mode).
   */
  activate(i: number): ActivateResult {
    if (i < 0 || i >= this.optionCount) return "noop";
    this.cursor = i;
    if (this.isOther(i)) {
      this.editingOther = true;
      return "edit-other";
    }
    if (this.spec.multiSelect) {
      if (this.multi.has(i)) this.multi.delete(i);
      else this.multi.add(i);
      return "toggled";
    }
    this.single = i;
    return "answered";
  }

  /**
   * Space in multi-select mode: toggles a preset option; on Other it
   * enters edit mode when not yet checked, unchecks when checked.
   */
  toggle(i: number): ActivateResult {
    if (!this.spec.multiSelect) return this.activate(i);
    if (i < 0 || i >= this.optionCount) return "noop";
    this.cursor = i;
    if (this.isOther(i)) {
      if (this.multi.has(i)) {
        this.multi.delete(i);
        return "toggled";
      }
      this.editingOther = true;
      return "edit-other";
    }
    if (this.multi.has(i)) this.multi.delete(i);
    else this.multi.add(i);
    return "toggled";
  }

  /** Commit the Other free text; false when empty (stays editing). */
  commitOther(text: string): boolean {
    const v = text.trim();
    if (v === "") return false;
    this.otherText = v;
    this.editingOther = false;
    if (this.spec.multiSelect) this.multi.add(this.otherIndex);
    else this.single = this.otherIndex;
    return true;
  }

  cancelOtherEdit(): void {
    this.editingOther = false;
  }

  /** Current answer value, undefined when nothing usable was chosen. */
  answer(): AnswerValue | undefined {
    if (this.spec.multiSelect) {
      const out: string[] = [];
      for (let i = 0; i < this.spec.options.length; i++) {
        if (this.multi.has(i)) out.push(this.spec.options[i]!.label);
      }
      if (this.multi.has(this.otherIndex) && this.otherText !== "") out.push(this.otherText);
      return out.length > 0 ? out : undefined;
    }
    if (this.single === undefined) return undefined;
    if (this.isOther(this.single)) return this.otherText !== "" ? this.otherText : undefined;
    return this.spec.options[this.single]?.label;
  }

  isAnswered(): boolean {
    return this.answer() !== undefined;
  }
}

/**
 * Format collected answers as the tool result text read by the model.
 * Multi-select answers render as a JSON array; skipped (dialog
 * submitted without an answer) and cancelled (Esc) are reported
 * distinctly so the model does not mistake silence for an answer.
 */
export function formatAnswers(answered: AnsweredQuestion[]): string {
  const multi = answered.length > 1;
  const lines = answered.map((a, i) => {
    const head =
      (multi ? `Q${i + 1}: ` : "Q: ") +
      a.question +
      (a.header ? ` [${a.header}]` : "");
    if (a.answer !== undefined) {
      const val = Array.isArray(a.answer)
        ? `[${a.answer.map((s) => JSON.stringify(s)).join(", ")}]`
        : a.answer;
      return `${head}\nA: ${val}`;
    }
    const why = a.status === "skipped" ? "skipped by user" : "user cancelled";
    return `${head}\nA: (no answer — ${why})`;
  });
  return lines.join("\n\n");
}
