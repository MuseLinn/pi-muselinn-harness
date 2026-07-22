// ============================================================
// Ask — interactive question dialog (adapter, pi-tui).
//
// One component drives the whole question set: a tab strip on top
// when there is more than one question (1/3 · header, ←/→/Tab to
// switch), numbered options with description sub-lines, checkbox
// semantics for multi_select (Space toggles, Enter confirms), and a
// synthetic Other option that opens a free-text input. Digit keys
// 1-9 still jump straight to an option; Esc cancels everything.
// Answering the last open question lands on a submit page; single
// question dialogs (e.g. permission approval) finish immediately.
// Rendered through ctx.ui.custom(); the same component backs the
// ask_user_question tool and the permission approval flow.
// ============================================================

import { Container, Input, Spacer, Text } from "@earendil-works/pi-tui";

import {
  AnswerState,
  digitToIndex,
  MAX_DIGIT_OPTIONS,
  OTHER_LABEL,
  type QuestionSpec,
} from "../packages/core/ask/types";

export interface QuestionsDialogResult {
  /** One state per question, in question order. */
  states: AnswerState[];
  /** True when the user pressed Esc (cancel) instead of submitting. */
  cancelled: boolean;
}

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_LEFT = "\x1b[D";
const KEY_RIGHT = "\x1b[C";
const KEY_ESC = "\x1b";
const KEY_ENTER_CR = "\r";
const KEY_ENTER_LF = "\n";
const KEY_TAB = "\t";
const KEY_SHIFT_TAB = "\x1b[Z";
const KEY_SPACE = " ";

export class QuestionDialogComponent extends Container {
  private readonly states: AnswerState[];
  /** Question index; specs.length means the submit page (multi-question only). */
  private tab = 0;
  private readonly otherInput = new Input();
  private readonly body: Container;
  private readonly onDone: (result: QuestionsDialogResult) => void;

  constructor(
    private readonly specs: QuestionSpec[],
    private readonly theme: any,
    onDone: (result: QuestionsDialogResult) => void,
  ) {
    super();
    this.onDone = onDone;
    this.states = specs.map((s) => new AnswerState(s));
    this.otherInput.onSubmit = (value) => this.commitOther(value);
    this.otherInput.onEscape = () => this.exitOtherEdit();
    this.body = new Container();
    this.addChild(this.body);
    this.rebuild();
  }

  // ── State helpers ─────────────────────────────────────────────

  private get multi(): boolean {
    return this.specs.length > 1;
  }

  private isSubmitPage(): boolean {
    return this.multi && this.tab === this.specs.length;
  }

  private current(): AnswerState {
    return this.states[Math.min(this.tab, this.states.length - 1)]!;
  }

  private cancel(): void {
    this.onDone({ states: this.states, cancelled: true });
  }

  private submit(): void {
    this.onDone({ states: this.states, cancelled: false });
  }

  private gotoTab(target: number): void {
    const total = this.multi ? this.specs.length + 1 : this.specs.length;
    const wrapped = ((target % total) + total) % total;
    if (wrapped === this.tab) return;
    this.tab = wrapped;
    this.rebuild();
  }

  /** After a question got answered: next unanswered question, else submit. */
  private advance(): void {
    if (!this.multi) {
      this.submit();
      return;
    }
    for (let i = this.tab + 1; i < this.states.length; i++) {
      if (!this.states[i]!.isAnswered()) {
        this.tab = i;
        this.rebuild();
        return;
      }
    }
    for (let i = 0; i < this.tab; i++) {
      if (!this.states[i]!.isAnswered()) {
        this.tab = i;
        this.rebuild();
        return;
      }
    }
    this.tab = this.specs.length; // submit page
    this.rebuild();
  }

  private commitOther(value: string): void {
    const st = this.current();
    if (!st.commitOther(value)) {
      this.rebuild(); // empty text — stay editing
      return;
    }
    if (st.spec.multiSelect) this.rebuild();
    else this.advance();
  }

  private exitOtherEdit(): void {
    this.current().cancelOtherEdit();
    this.rebuild();
  }

  // ── Input ─────────────────────────────────────────────────────

  handleInput(keyData: string): void {
    const st = this.current();

    if (st.editingOther && !this.isSubmitPage()) {
      // Esc is routed to otherInput.onEscape by Input itself.
      if (keyData === KEY_UP || keyData === KEY_DOWN) {
        this.exitOtherEdit();
        st.moveCursor(keyData === KEY_UP ? -1 : 1);
        this.rebuild();
        return;
      }
      this.otherInput.handleInput(keyData);
      this.rebuild();
      return;
    }

    if (keyData === KEY_ESC || keyData === "q") {
      this.cancel();
      return;
    }

    if (this.isSubmitPage()) {
      if (keyData === KEY_ENTER_CR || keyData === KEY_ENTER_LF) {
        this.submit();
        return;
      }
      if (keyData === KEY_LEFT || keyData === KEY_SHIFT_TAB) this.gotoTab(this.tab - 1);
      else if (keyData === KEY_RIGHT || keyData === KEY_TAB) this.gotoTab(this.tab + 1);
      return;
    }

    // Tab switching (multi-question only).
    if (this.multi) {
      if (keyData === KEY_LEFT || keyData === KEY_SHIFT_TAB) {
        this.gotoTab(this.tab - 1);
        return;
      }
      if (keyData === KEY_RIGHT || keyData === KEY_TAB) {
        this.gotoTab(this.tab + 1);
        return;
      }
    }

    if (keyData === KEY_UP || keyData === "k") {
      st.moveCursor(-1);
      this.rebuild();
      return;
    }
    if (keyData === KEY_DOWN || keyData === "j") {
      st.moveCursor(1);
      this.rebuild();
      return;
    }

    // Digit direct select (1-9).
    const digit = digitToIndex(keyData, st.optionCount);
    if (digit >= 0) {
      const r = st.activate(digit);
      if (r === "answered") this.advance();
      else this.rebuild();
      return;
    }

    if (keyData === KEY_SPACE && st.spec.multiSelect) {
      st.toggle(st.cursor);
      this.rebuild();
      return;
    }

    if (keyData === KEY_ENTER_CR || keyData === KEY_ENTER_LF) {
      if (st.spec.multiSelect && !st.isOther(st.cursor)) {
        this.advance(); // Enter confirms the whole question in multi mode
        return;
      }
      const r = st.activate(st.cursor);
      if (r === "answered") this.advance();
      else this.rebuild();
      return;
    }
  }

  // ── Render ────────────────────────────────────────────────────

  private rebuild(): void {
    this.body.clear();
    if (this.isSubmitPage()) this.renderSubmitPage();
    else this.renderQuestionPage();
  }

  private renderQuestionPage(): void {
    const theme = this.theme;
    const st = this.current();
    const spec = st.spec;

    if (this.multi) this.body.addChild(new Text(this.tabLine(), 1, 0));
    this.body.addChild(new Text(theme.fg("accent", theme.bold(`? ${spec.question}`)), 1, 0));
    this.body.addChild(new Spacer(1));

    for (let i = 0; i < st.optionCount; i++) {
      const isCursor = i === st.cursor;
      const isOther = st.isOther(i);
      const selected = st.isSelected(i);
      const label = isOther ? this.otherLabel(st) : spec.options[i]!.label;
      const num = i < MAX_DIGIT_OPTIONS ? theme.fg("dim", `${i + 1}. `) : "    ";

      let line: string;
      if (spec.multiSelect) {
        const box = selected ? theme.fg("success", "[x] ") : theme.fg("dim", "[ ] ");
        const text =
          selected && isCursor
            ? theme.fg("success", theme.bold(label))
            : selected
              ? theme.fg("success", label)
              : isCursor
                ? theme.fg("accent", theme.bold(label))
                : theme.fg("text", label);
        line = (isCursor ? theme.fg("accent", "→ ") : "  ") + box + num + text;
      } else {
        const text =
          selected && isCursor
            ? theme.fg("success", theme.bold(label))
            : selected
              ? theme.fg("success", label)
              : isCursor
                ? theme.fg("accent", theme.bold(label))
                : theme.fg("text", label);
        line = (isCursor ? theme.fg("accent", "→ ") : "  ") + num + text;
      }
      this.body.addChild(new Text(line, 1, 0));

      if (!isOther) {
        const desc = spec.options[i]!.description;
        if (desc) this.body.addChild(new Text(theme.fg("dim", `        ${desc}`), 1, 0));
      } else if (isCursor && st.editingOther) {
        this.otherInput.focused = true;
        this.body.addChild(this.otherInput);
      }
    }

    this.body.addChild(new Spacer(1));
    this.body.addChild(new Text(theme.fg("dim", this.hintLine()), 1, 0));
  }

  private renderSubmitPage(): void {
    const theme = this.theme;
    this.body.addChild(new Text(this.tabLine(), 1, 0));
    this.body.addChild(new Text(theme.fg("accent", theme.bold("Review your answers")), 1, 0));
    const unanswered = this.states.filter((s) => !s.isAnswered()).length;
    if (unanswered > 0) {
      this.body.addChild(new Text(
        theme.fg("warning", `${unanswered} question(s) unanswered — they will be reported as skipped`),
        1, 0,
      ));
    }
    this.body.addChild(new Spacer(1));
    for (let i = 0; i < this.specs.length; i++) {
      const spec = this.specs[i]!;
      const st = this.states[i]!;
      const answer = st.answer();
      const val = answer === undefined
        ? theme.fg("dim", "(skipped)")
        : theme.fg("text", Array.isArray(answer) ? answer.join(", ") : answer);
      this.body.addChild(new Text(
        theme.fg("dim", `Q${i + 1} `) + theme.fg("text", spec.question),
        1, 0,
      ));
      this.body.addChild(new Text(theme.fg("accent", "  → ") + val, 1, 0));
    }
    this.body.addChild(new Spacer(1));
    this.body.addChild(new Text(
      theme.fg("dim", "Enter submit · ←/→ back to questions · Esc cancel"),
      1, 0,
    ));
  }

  /** Top tab strip: `1/3 · header` + per-question status + Submit. */
  private tabLine(): string {
    const theme = this.theme;
    const parts: string[] = [];
    for (let i = 0; i < this.specs.length; i++) {
      const label = this.specs[i]!.header || `Q${i + 1}`;
      if (i === this.tab) {
        parts.push(theme.fg("accent", theme.bold(`${i + 1}/${this.specs.length} · ${label}`)));
      } else if (this.states[i]!.isAnswered()) {
        parts.push(theme.fg("success", `✓ ${label}`));
      } else {
        parts.push(theme.fg("dim", `○ ${label}`));
      }
    }
    parts.push(
      this.isSubmitPage()
        ? theme.fg("accent", theme.bold("Submit"))
        : theme.fg("dim", "Submit"),
    );
    return parts.join(theme.fg("dim", "  ·  "));
  }

  private otherLabel(st: AnswerState): string {
    return st.otherText !== "" ? `${OTHER_LABEL}: ${st.otherText}` : OTHER_LABEL;
  }

  private hintLine(): string {
    const st = this.current();
    if (st.editingOther) return "type answer · Enter save · Esc stop editing";
    const tabs = this.multi ? " · ←/→/Tab switch" : "";
    if (st.spec.multiSelect) {
      return `↑↓/jk move · 1-9/Space toggle · Enter confirm${tabs} · Esc cancel`;
    }
    return `↑↓/jk navigate · 1-9 select · Enter confirm${tabs} · Esc cancel`;
  }
}
