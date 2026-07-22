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
  /**
   * Markdown preview rendered for this option (rpiv parity: mockups, code
   * snippets, visual comparisons). When ANY option of a question carries a
   * preview, the dialog switches to a left-options + right-preview layout
   * (stacked below the options on narrow terminals — see decideLayout).
   */
  preview?: string;
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
  /**
   * Append a synthetic "Chat about this" row (ask tool default). Picking it
   * ends the dialog with kind "chat" for this question — the model learns the
   * user wants to discuss instead of answering. Permission approval specs
   * leave this off, so their dialog is unchanged.
   */
  allowChat?: boolean;
  /** Long-form context shown under the question (≤ MAX_BODY_LINES rendered). */
  body?: string;
  /** Custom label for the synthetic Other option (default OTHER_LABEL). */
  otherLabel?: string;
  /** Custom description line for the synthetic Other option. */
  otherDescription?: string;
}

/** Single-select answers are strings; multi-select answers are arrays. */
export type AnswerValue = string | string[];

export type AnswerStatus = "answered" | "skipped" | "cancelled";

/**
 * Machine-readable outcome discriminator (rpiv response-envelope parity).
 * "selected" = an answer value is present; "skipped" = submitted without an
 * answer; "cancelled" = Esc; "chat" = the user picked the "Chat about this"
 * row and wants to discuss the question instead of answering it. Legacy
 * callers only set `status`; `kind` is additive.
 */
export type AnswerKind = "selected" | "skipped" | "cancelled" | "chat";

/** A free-text note the user attached to a preview-bearing option (`n` key). */
export interface AnswerNote {
  /** Label of the option the note belongs to. */
  option: string;
  text: string;
}

export interface AnsweredQuestion {
  question: string;
  header?: string;
  /** Present iff status is "answered". */
  answer?: AnswerValue;
  /** Defaults to "cancelled" when answer is undefined (legacy callers). */
  status?: AnswerStatus;
  /** Structured outcome; downstream can switch on this without parsing text. */
  kind?: AnswerKind;
  /** Per-option notes collected via the `n` key (empty/absent when none). */
  notes?: AnswerNote[];
}

/** Max options shown with digit shortcuts (1-9). */
export const MAX_DIGIT_OPTIONS = 9;

/** Max questions per ask_user_question call. */
export const MAX_QUESTIONS = 4;

/** Max length of a question header (tab label); longer ones are truncated. */
export const MAX_HEADER_LEN = 12;

/** Label of the synthetic free-text option appended when allowOther. */
export const OTHER_LABEL = "Other";

/** Label of the synthetic row appended when allowChat. */
export const CHAT_LABEL = "Chat about this";

/** Label of the submit tab on multi-question dialogs. */
export const SUBMIT_LABEL = "Submit";

/**
 * Option labels reserved for synthetic rows/pages (rpiv reserved_label
 * guard parity): authoring an option with one of these labels is rejected
 * so the synthetic rows stay unambiguous. Exact match, by design — "other"
 * lowercase is an ordinary label.
 */
export const RESERVED_LABELS: readonly string[] = [OTHER_LABEL, CHAT_LABEL, SUBMIT_LABEL];

/** Min terminal width (columns) for the side-by-side preview layout. */
export const PREVIEW_MIN_WIDTH = 100;

/** Preview layout mode: split columns, or preview stacked under the options. */
export type AskLayoutMode = "side-by-side" | "stacked";

/** True when any option of the question carries a markdown preview. */
export function hasAnyPreview(spec: QuestionSpec): boolean {
  return spec.options.some((o) => typeof o.preview === "string" && o.preview.trim() !== "");
}

/**
 * Layout decision for the preview pane (pure). Side-by-side only engages
 * when the question actually has previews AND the terminal is wide enough;
 * below PREVIEW_MIN_WIDTH columns the preview stacks under the option list.
 */
export function decideLayout(terminalWidth: number, preview: boolean): AskLayoutMode {
  return preview && terminalWidth >= PREVIEW_MIN_WIDTH ? "side-by-side" : "stacked";
}

/** Max options rendered at once; the window follows the cursor. */
export const MAX_VISIBLE_OPTIONS = 6;

/** Max body lines rendered under a question; the rest get a "+N more" note. */
export const MAX_BODY_LINES = 12;

export interface OptionWindow {
  /** First visible option index. */
  start: number;
  /** One past the last visible option index. */
  end: number;
  /** Options hidden above the window (overflow indicator count). */
  hiddenAbove: number;
  /** Options hidden below the window (overflow indicator count). */
  hiddenBelow: number;
}

/**
 * Visible option window over [0, total) that keeps `cursor` in view
 * (kimi-code question-dialog parity: maxVisibleOptions = 6, cursor
 * centered when possible, clamped at both ends). Small terminals never
 * overflow because at most maxVisible option rows are rendered.
 */
export function optionWindow(
  cursor: number,
  total: number,
  maxVisible: number = MAX_VISIBLE_OPTIONS,
): OptionWindow {
  if (total <= 0 || maxVisible <= 0) return { start: 0, end: 0, hiddenAbove: 0, hiddenBelow: 0 };
  if (total <= maxVisible) return { start: 0, end: total, hiddenAbove: 0, hiddenBelow: 0 };
  const half = Math.floor(maxVisible / 2);
  const maxStart = total - maxVisible;
  const start = Math.max(0, Math.min(cursor - half, maxStart));
  const end = Math.min(total, start + maxVisible);
  return { start, end, hiddenAbove: start, hiddenBelow: total - end };
}

/** Trimmed body split into lines: first MAX_BODY_LINES plus overflow count. */
export function bodyLines(body: string | undefined, maxLines: number = MAX_BODY_LINES): { lines: string[]; hidden: number } {
  const trimmed = (body ?? "").trim();
  if (trimmed === "") return { lines: [], hidden: 0 };
  const all = trimmed.split("\n");
  if (all.length <= maxLines) return { lines: all, hidden: 0 };
  return { lines: all.slice(0, maxLines), hidden: all.length - maxLines };
}

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
export const QUESTION_UNIQUENESS_MESSAGE =
  "Question texts must be unique across questions, and option labels must be unique within each question.";

export const RESERVED_LABEL_MESSAGE =
  `Option labels must not collide with reserved synthetic labels (${RESERVED_LABELS.join(", ")}).`;

/**
 * Answers are keyed by question text with option labels as values, so
 * both must be unambiguous (kimi-code ask-user.ts parity): question
 * texts unique across the call, option labels unique within their
 * question. Reserved labels (Other / Chat about this / Submit, plus a
 * custom other_label) are rejected FIRST (rpiv parity: reserved_label
 * short-circuits before duplicate_option_label). Returns an error
 * message, or null when valid.
 */
export function questionUniquenessError(specs: QuestionSpec[]): string | null {
  const texts = new Set<string>();
  for (const q of specs) {
    if (texts.has(q.question)) {
      return `duplicate question text ${JSON.stringify(q.question)}. ${QUESTION_UNIQUENESS_MESSAGE} Rephrase the duplicates and call the tool again.`;
    }
    texts.add(q.question);
    const reserved = new Set<string>(RESERVED_LABELS);
    if (q.otherLabel) reserved.add(q.otherLabel);
    const labels = new Set<string>();
    for (const o of q.options) {
      if (reserved.has(o.label)) {
        return `reserved option label ${JSON.stringify(o.label)} in question ${JSON.stringify(q.question)}. ${RESERVED_LABEL_MESSAGE} Rename the option and call the tool again.`;
      }
      if (labels.has(o.label)) {
        return `duplicate option label ${JSON.stringify(o.label)} in question ${JSON.stringify(q.question)}. ${QUESTION_UNIQUENESS_MESSAGE} Rephrase the duplicates and call the tool again.`;
      }
      labels.add(o.label);
    }
  }
  return null;
}

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
  const specs = rawList.map((q: any, qi: number) => {
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
      const preview =
        typeof o === "object" && o && typeof o.preview === "string" && o.preview.trim() !== ""
          ? o.preview
          : undefined;
      return { label, description: typeof o === "object" && o ? o.description : undefined, preview };
    });
    let header: string | undefined;
    if (typeof q.header === "string" && q.header.trim() !== "") {
      header = q.header.trim().slice(0, MAX_HEADER_LEN);
    }
    const body = typeof q.body === "string" && q.body.trim() !== "" ? q.body : undefined;
    const otherLabelRaw = q.other_label ?? q.otherLabel;
    const otherLabel =
      typeof otherLabelRaw === "string" && otherLabelRaw.trim() !== "" ? otherLabelRaw.trim() : undefined;
    const otherDescRaw = q.other_description ?? q.otherDescription;
    const otherDescription =
      typeof otherDescRaw === "string" && otherDescRaw.trim() !== "" ? otherDescRaw : undefined;
    return {
      question: q.question,
      header,
      options,
      multiSelect: q.multi_select === true || q.multiSelect === true,
      allowOther: true,
      allowChat: true,
      body,
      otherLabel,
      otherDescription,
    };
  });
  const dup = questionUniquenessError(specs);
  if (dup) throw new Error(`ask_user_question: ${dup}`);
  return specs;
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
export type ActivateResult = "answered" | "toggled" | "edit-other" | "chat" | "noop";

/**
 * Per-question answer state machine (pure — the pi-tui dialog is a
 * thin renderer/input-router over this). Covers single-select,
 * multi-select (checkbox), the synthetic Other free-text option, the
 * synthetic Chat row, and per-option notes on preview-bearing options.
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
  /** Per-option notes (option index → text); only preview options eligible. */
  readonly notes: Map<number, string> = new Map<number, string>();
  /** True while the note input owns the keyboard. */
  editingNote = false;
  /** Option index the open note input edits (-1 = none). */
  noteTarget = -1;

  constructor(spec: QuestionSpec) {
    this.spec = spec;
  }

  get optionCount(): number {
    return (
      this.spec.options.length +
      (this.spec.allowOther ? 1 : 0) +
      (this.spec.allowChat ? 1 : 0)
    );
  }

  get otherIndex(): number {
    return this.spec.options.length;
  }

  /** Chat row sits last, after the Other row when both are present. */
  get chatIndex(): number {
    return this.spec.options.length + (this.spec.allowOther ? 1 : 0);
  }

  isOther(i: number): boolean {
    return this.spec.allowOther === true && i === this.otherIndex;
  }

  isChat(i: number): boolean {
    return this.spec.allowChat === true && i === this.chatIndex;
  }

  /** Notes attach to author-defined preview-bearing options only. */
  hasPreviewOption(i: number): boolean {
    if (i < 0 || i >= this.spec.options.length) return false;
    const p = this.spec.options[i]!.preview;
    return typeof p === "string" && p.trim() !== "";
  }

  isSelected(i: number): boolean {
    return this.spec.multiSelect ? this.multi.has(i) : this.single === i;
  }

  moveCursor(delta: number): void {
    this.cursor = moveIndex(this.cursor, delta, this.optionCount);
  }

  /**
   * Enter / digit key on option i. Single-select: picks (Other enters
   * edit mode, Chat reports "chat"). Multi-select: toggles (Other enters
   * edit mode, Chat reports "chat").
   */
  activate(i: number): ActivateResult {
    if (i < 0 || i >= this.optionCount) return "noop";
    this.cursor = i;
    if (this.isChat(i)) return "chat";
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
   * The Chat row is not toggleable.
   */
  toggle(i: number): ActivateResult {
    if (!this.spec.multiSelect) return this.activate(i);
    if (i < 0 || i >= this.optionCount) return "noop";
    this.cursor = i;
    if (this.isChat(i)) return "noop";
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

  /**
   * Open the note editor for option i (`n` key). Only preview-bearing
   * author-defined options are eligible; returns false otherwise.
   */
  startNoteEdit(i: number): boolean {
    if (!this.hasPreviewOption(i)) return false;
    this.cursor = i;
    this.noteTarget = i;
    this.editingNote = true;
    return true;
  }

  /**
   * Commit the note text for noteTarget. Notes are optional, so an empty
   * commit CLEARS the note (unlike commitOther, which rejects empty text).
   */
  commitNote(text: string): void {
    const v = text.trim();
    if (this.noteTarget >= 0) {
      if (v === "") this.notes.delete(this.noteTarget);
      else this.notes.set(this.noteTarget, v);
    }
    this.editingNote = false;
    this.noteTarget = -1;
  }

  cancelNoteEdit(): void {
    this.editingNote = false;
    this.noteTarget = -1;
  }

  /** Committed notes in option order, resolved to {option label, text}. */
  answerNotes(): AnswerNote[] {
    const out: AnswerNote[] = [];
    for (let i = 0; i < this.spec.options.length; i++) {
      const text = this.notes.get(i);
      if (text !== undefined && text !== "") out.push({ option: this.spec.options[i]!.label, text });
    }
    return out;
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
 * kind "chat" tells the model the user wants to discuss the question
 * instead of answering it; per-option notes render as `N:` lines.
 */
export function formatAnswers(answered: AnsweredQuestion[]): string {
  const multi = answered.length > 1;
  const lines = answered.map((a, i) => {
    const head =
      (multi ? `Q${i + 1}: ` : "Q: ") +
      a.question +
      (a.header ? ` [${a.header}]` : "");
    let body: string;
    if (a.answer !== undefined) {
      const val = Array.isArray(a.answer)
        ? `[${a.answer.map((s) => JSON.stringify(s)).join(", ")}]`
        : a.answer;
      body = `${head}\nA: ${val}`;
      if (a.kind === "chat") body += "\n(user also wants to chat about this question)";
    } else if (a.kind === "chat") {
      body = `${head}\nA: (no answer — user wants to chat about this question)`;
    } else {
      const why = a.status === "skipped" ? "skipped by user" : "user cancelled";
      body = `${head}\nA: (no answer — ${why})`;
    }
    for (const note of a.notes ?? []) {
      body += `\nN: [${note.option}] ${note.text}`;
    }
    return body;
  });
  return lines.join("\n\n");
}

/**
 * Task id for a background question (ask- prefix to keep question tasks
 * distinguishable from bg- subagent tasks in task_list).
 */
export function backgroundQuestionTaskId(
  now: number = Date.now(),
  rand: string = Math.random().toString(36).slice(2, 6),
): string {
  return `ask-${now.toString(36)}-${rand}`;
}

/** Short one-line description for the background task entry. */
export function questionTaskDescription(specs: QuestionSpec[]): string {
  const first = specs[0]?.question.trim() ?? "";
  const label = first === "" ? "Ask user question" : first;
  return specs.length <= 1 ? label : `${label} (+${specs.length - 1} more)`;
}

/**
 * Immediate tool-result text for background mode (kimi-code ask-user
 * parity: return at once with the task_id; the answer is persisted via
 * appendEntry + a completion notification when the user responds).
 */
export function backgroundStartText(taskId: string, description: string): string {
  return (
    `task_id: ${taskId}\n` +
    `description: ${description}\n` +
    "status: running\n" +
    "automatic_notification: true\n" +
    "next_step: Continue your current work; the answer is persisted and you are notified when the user responds.\n" +
    "next_step: Use task_output with this task_id for a non-blocking status/answer snapshot (block=true to wait for it).\n" +
    "next_step: Use task_stop only if the question should be cancelled."
  );
}
