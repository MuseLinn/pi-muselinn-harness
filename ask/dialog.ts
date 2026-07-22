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
//
// rpiv-ask-user-question parity additions (ask tool only — permission
// specs set neither preview nor allowChat, so their dialog renders
// exactly as before):
// - options[].preview (markdown): any preview on the question switches
//   to a left-options + right-preview layout (decideLayout; stacked
//   below the options when the terminal is < PREVIEW_MIN_WIDTH cols).
//   Previews render through pi-tui's Markdown inside an ASCII border;
//   rendered lines are cached per option, keyed by render width.
// - `n` on a preview-bearing option opens a free-text note input; the
//   note travels with the answer (AnsweredQuestion.notes).
// - a synthetic "Chat about this" row ends the dialog with
//   result.chatIndex set — the user wants to discuss, not answer.
// ============================================================

import {
  Container,
  Input,
  Markdown,
  Spacer,
  Text,
  truncateToWidth,
  visibleWidth,
  type Component,
  type MarkdownTheme,
} from "@earendil-works/pi-tui";

import {
  AnswerState,
  bodyLines,
  CHAT_LABEL,
  decideLayout,
  digitToIndex,
  hasAnyPreview,
  MAX_DIGIT_OPTIONS,
  MAX_VISIBLE_OPTIONS,
  optionWindow,
  OTHER_LABEL,
  type QuestionSpec,
} from "../packages/core/ask/types";

export interface QuestionsDialogResult {
  /** One state per question, in question order. */
  states: AnswerState[];
  /** True when the user pressed Esc (cancel) instead of submitting. */
  cancelled: boolean;
  /** Index of the question the user picked "Chat about this" on. */
  chatIndex?: number;
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

/** Gap between the options column and the preview column (side-by-side). */
const PREVIEW_GAP = 2;
/** Left column never takes more than this fraction of the pane. */
const PREVIEW_MAX_LEFT_RATIO = 0.5;
/** Right (preview) column keeps at least this many columns. */
const PREVIEW_MIN_RIGHT = 40;
/** Left column floor so short labels don't collapse the layout. */
const PREVIEW_MIN_LEFT = 24;
/** Preview body lines shown inside the border; the rest get a hidden note. */
const MAX_PREVIEW_LINES = 16;
/** Don't bother rendering a preview box narrower than this. */
const PREVIEW_MIN_BOX_WIDTH = 24;

const ANSI_SGR_RE = /\x1b\[[0-9;]*m/g;
const ANSI_OSC8_RE = /\x1b\]8;[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const FENCE_MARKER_RE = /^`{3}/;

/**
 * Drop fenced-code-block marker lines (``` openers/closers) from rendered
 * markdown (rpiv stripFenceMarkers parity): pi-tui's Markdown emits literal
 * fence lines around code blocks; the highlight body is kept.
 */
function stripFenceMarkers(lines: readonly string[]): string[] {
  return lines.filter((line) => {
    const clean = line.replace(ANSI_SGR_RE, "").replace(ANSI_OSC8_RE, "");
    return !FENCE_MARKER_RE.test(clean);
  });
}

/**
 * Wrap `lines` in a 4-sided ASCII border with 1 col of inner horizontal
 * padding (rpiv renderBorderedBox parity). When hidden > 0 the bottom row
 * carries a "✂ ── N lines hidden ──" indicator.
 */
function renderPreviewBox(
  lines: readonly string[],
  width: number,
  colorFn: (s: string) => string,
  hidden = 0,
): string[] {
  const dashSpan = Math.max(1, width - 2);
  const contentInner = Math.max(1, dashSpan - 2);
  const out: string[] = [colorFn(`┌${"─".repeat(dashSpan)}┐`)];
  for (const line of lines) {
    const padded = truncateToWidth(line, contentInner, "", true);
    out.push(`${colorFn("│")} ${padded} ${colorFn("│")}`);
  }
  if (hidden > 0) {
    const indicator = ` ✂ ── ${hidden} lines hidden ── `;
    const space = dashSpan - indicator.length;
    const leftFill = "─".repeat(Math.max(0, Math.floor(space / 2)));
    const rightFill = "─".repeat(Math.max(0, dashSpan - leftFill.length - indicator.length));
    out.push(colorFn(`└${leftFill}${indicator}${rightFill}┘`));
  } else {
    out.push(colorFn(`└${"─".repeat(dashSpan)}┘`));
  }
  return out;
}

/**
 * Line-level merge of the options column and the preview column. Children
 * of a Container each get the full width, so side-by-side composition has
 * to happen at the string level (rpiv preview-pane parity).
 */
class SideBySide implements Component {
  constructor(
    private readonly left: string[],
    private readonly right: string[],
    private readonly leftWidth: number,
    private readonly gap: number,
  ) {}

  invalidate(): void {}

  render(_width: number): string[] {
    const rows = Math.max(this.left.length, this.right.length);
    const out: string[] = [];
    for (let r = 0; r < rows; r++) {
      const raw = r < this.left.length ? this.left[r]! : "";
      const l = truncateToWidth(raw, this.leftWidth, "", true);
      const rr = r < this.right.length ? this.right[r]! : "";
      out.push(l + " ".repeat(this.gap) + rr);
    }
    return out;
  }
}

export class QuestionDialogComponent extends Container {
  private readonly states: AnswerState[];
  /** Question index; specs.length means the submit page (multi-question only). */
  private tab = 0;
  private readonly otherInput = new Input();
  private readonly noteInput = new Input();
  private readonly body: Container;
  private readonly onDone: (result: QuestionsDialogResult) => void;
  private readonly mdTheme: MarkdownTheme;
  /**
   * Rendered preview lines per `${tab}:${option}` — width-keyed: a width
   * change re-wraps the markdown and replaces the entry (rpiv
   * MarkdownContentCache parity). Bounded by questions × options.
   */
  private readonly previewCache = new Map<string, { width: number; lines: string[] }>();
  /** Last render() width; layout decisions and the preview cache key off it. */
  private lastWidth = 0;

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
    this.noteInput.onSubmit = (value) => this.commitNote(value);
    this.noteInput.onEscape = () => this.exitNoteEdit();
    this.mdTheme = {
      heading: (t: string) => theme.fg("accent", theme.bold(t)),
      link: (t: string) => theme.fg("accent", t),
      linkUrl: (t: string) => theme.fg("dim", t),
      code: (t: string) => theme.fg("warning", t),
      codeBlock: (t: string) => theme.fg("text", t),
      codeBlockBorder: (t: string) => theme.fg("dim", t),
      quote: (t: string) => theme.fg("dim", t),
      quoteBorder: (t: string) => theme.fg("dim", t),
      hr: (t: string) => theme.fg("dim", t),
      listBullet: (t: string) => theme.fg("dim", t),
      bold: (t: string) => theme.bold(t),
      italic: (t: string) => t,
      strikethrough: (t: string) => t,
      underline: (t: string) => t,
    };
    this.body = new Container();
    this.addChild(this.body);
    this.rebuild();
  }

  /**
   * Track the viewport width: layout mode (decideLayout) and the
   * width-keyed preview cache both derive from it, so a resize rebuilds.
   */
  render(width: number): string[] {
    if (width > 0 && width !== this.lastWidth) {
      this.lastWidth = width;
      this.rebuild();
    }
    return super.render(width);
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

  /** "Chat about this" row picked: end the dialog, flag the question. */
  private chatAbout(): void {
    this.onDone({
      states: this.states,
      cancelled: false,
      chatIndex: Math.min(this.tab, this.states.length - 1),
    });
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

  private commitNote(value: string): void {
    this.current().commitNote(value);
    this.rebuild();
  }

  private exitNoteEdit(): void {
    this.current().cancelNoteEdit();
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

    if (st.editingNote && !this.isSubmitPage()) {
      // Esc is routed to noteInput.onEscape by Input itself.
      if (keyData === KEY_UP || keyData === KEY_DOWN) {
        this.exitNoteEdit();
        st.moveCursor(keyData === KEY_UP ? -1 : 1);
        this.rebuild();
        return;
      }
      this.noteInput.handleInput(keyData);
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

    // Free-text note on the preview-bearing option under the cursor.
    if (keyData === "n" && st.hasPreviewOption(st.cursor)) {
      if (st.startNoteEdit(st.cursor)) {
        this.noteInput.setValue(st.notes.get(st.cursor) ?? "");
        this.noteInput.focused = true;
      }
      this.rebuild();
      return;
    }

    // Digit direct select (1-9).
    const digit = digitToIndex(keyData, st.optionCount);
    if (digit >= 0) {
      const r = st.activate(digit);
      if (r === "chat") this.chatAbout();
      else if (r === "answered") this.advance();
      else this.rebuild();
      return;
    }

    if (keyData === KEY_SPACE && st.spec.multiSelect) {
      st.toggle(st.cursor);
      this.rebuild();
      return;
    }

    if (keyData === KEY_ENTER_CR || keyData === KEY_ENTER_LF) {
      if (st.spec.multiSelect && !st.isOther(st.cursor) && !st.isChat(st.cursor)) {
        this.advance(); // Enter confirms the whole question in multi mode
        return;
      }
      const r = st.activate(st.cursor);
      if (r === "chat") this.chatAbout();
      else if (r === "answered") this.advance();
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

    // Long-form context under the question (≤ MAX_BODY_LINES + overflow note).
    const body = bodyLines(spec.body);
    if (body.lines.length > 0) {
      for (const line of body.lines) {
        this.body.addChild(new Text(theme.fg("dim", `  ${line}`), 1, 0));
      }
      if (body.hidden > 0) {
        this.body.addChild(new Text(theme.fg("dim", `  ... ${body.hidden} more line(s)`), 1, 0));
      }
    }
    this.body.addChild(new Spacer(1));

    const preview = hasAnyPreview(spec);
    if (decideLayout(this.lastWidth, preview) === "side-by-side") {
      this.renderSideBySide(st);
    } else {
      this.renderStackedOptions(st);
      // Narrow terminal degrade: the preview stacks under the option list.
      if (preview) {
        for (const line of this.previewBlock(st, this.lastWidth)) {
          this.body.addChild(new Text(line, 1, 0));
        }
      }
    }

    this.body.addChild(new Spacer(1));
    this.body.addChild(new Text(theme.fg("dim", this.hintLine()), 1, 0));
  }

  /**
   * Left options + right preview. Inputs (Other / note) can't sit inside
   * the merged string columns, so they render right after the block.
   */
  private renderSideBySide(st: AnswerState): void {
    const theme = this.theme;
    const left: string[] = [];
    const win = optionWindow(st.cursor, st.optionCount);
    if (win.hiddenAbove > 0) left.push(theme.fg("dim", `    ↑ ${win.hiddenAbove} more`));
    for (let i = win.start; i < win.end; i++) {
      left.push(this.optionLine(st, i));
      const sub = this.subLine(st, i);
      if (sub) left.push(sub);
    }
    if (win.hiddenBelow > 0) left.push(theme.fg("dim", `    ↓ ${win.hiddenBelow} more`));

    const leftWidth = this.leftColumnWidth(left);
    const right = this.previewBlock(st, this.lastWidth - leftWidth - PREVIEW_GAP);
    if (right.length === 0) {
      for (const line of left) this.body.addChild(new Text(line, 1, 0));
    } else {
      this.body.addChild(new SideBySide(left, right, leftWidth, PREVIEW_GAP));
    }

    if (st.editingOther) {
      this.body.addChild(new Text(theme.fg("dim", `  ${st.spec.otherLabel ?? OTHER_LABEL}:`), 1, 0));
      this.otherInput.focused = true;
      this.body.addChild(this.otherInput);
    }
    if (st.editingNote) {
      this.body.addChild(new Text(
        theme.fg("dim", `  note for ${st.spec.options[st.noteTarget]?.label ?? ""}:`),
        1, 0,
      ));
      this.noteInput.focused = true;
      this.body.addChild(this.noteInput);
    }
  }

  /** Classic single-column option list (inline Other / note inputs). */
  private renderStackedOptions(st: AnswerState): void {
    const theme = this.theme;

    // Scrolled option window (kimi-code parity: at most MAX_VISIBLE_OPTIONS
    // rows; the window follows the cursor, overflow gets ↑/↓ indicators).
    const win = optionWindow(st.cursor, st.optionCount);
    if (win.hiddenAbove > 0) {
      this.body.addChild(new Text(theme.fg("dim", `    ↑ ${win.hiddenAbove} more`), 1, 0));
    }

    for (let i = win.start; i < win.end; i++) {
      const isCursor = i === st.cursor;
      const isOther = st.isOther(i);
      this.body.addChild(new Text(this.optionLine(st, i), 1, 0));

      if (isOther && isCursor && st.editingOther) {
        this.otherInput.focused = true;
        this.body.addChild(this.otherInput);
      } else if (isCursor && st.editingNote && st.noteTarget === i) {
        this.noteInput.focused = true;
        this.body.addChild(this.noteInput);
      } else {
        const sub = this.subLine(st, i);
        if (sub) this.body.addChild(new Text(sub, 1, 0));
      }
    }

    if (win.hiddenBelow > 0) {
      this.body.addChild(new Text(theme.fg("dim", `    ↓ ${win.hiddenBelow} more`), 1, 0));
    }
  }

  /** Primary styled row for option i (cursor arrow, checkbox, number, label). */
  private optionLine(st: AnswerState, i: number): string {
    const theme = this.theme;
    const spec = st.spec;
    const isCursor = i === st.cursor;
    const isOther = st.isOther(i);
    const isChat = st.isChat(i);
    const selected = st.isSelected(i);
    const label = isOther ? this.otherLabel(st) : isChat ? CHAT_LABEL : spec.options[i]!.label;
    const noteMark = !isOther && !isChat && st.notes.has(i) ? theme.fg("dim", " (note)") : "";
    const num = i < MAX_DIGIT_OPTIONS ? theme.fg("dim", `${i + 1}. `) : "    ";

    const text =
      selected && isCursor
        ? theme.fg("success", theme.bold(label))
        : selected
          ? theme.fg("success", label)
          : isCursor
            ? theme.fg("accent", theme.bold(label))
            : isChat
              ? theme.fg("dim", label)
              : theme.fg("text", label);
    if (spec.multiSelect && !isChat) {
      const box = selected ? theme.fg("success", "[x] ") : theme.fg("dim", "[ ] ");
      return (isCursor ? theme.fg("accent", "→ ") : "  ") + box + num + text + noteMark;
    }
    return (isCursor ? theme.fg("accent", "→ ") : "  ") + num + text + noteMark;
  }

  /** Indented secondary line: option description / Other description / chat hint / committed note. */
  private subLine(st: AnswerState, i: number): string | null {
    const theme = this.theme;
    const spec = st.spec;
    if (st.isChat(i)) {
      return theme.fg("dim", "        discuss this question with the agent instead");
    }
    if (st.isOther(i)) {
      return spec.otherDescription ? theme.fg("dim", `        ${spec.otherDescription}`) : null;
    }
    const parts: string[] = [];
    const desc = spec.options[i]!.description;
    if (desc) parts.push(desc);
    const note = st.notes.get(i);
    if (note) parts.push(`note: ${note}`);
    return parts.length > 0 ? theme.fg("dim", `        ${parts.join(" · ")}`) : null;
  }

  /** Adaptive left column: longest row, clamped to ratio + preview floor. */
  private leftColumnWidth(left: string[]): number {
    let widest = 0;
    for (const line of left) {
      const w = visibleWidth(line);
      if (w > widest) widest = w;
    }
    const ratioCap = Math.floor(this.lastWidth * PREVIEW_MAX_LEFT_RATIO);
    const previewFloor = this.lastWidth - PREVIEW_GAP - PREVIEW_MIN_RIGHT;
    return Math.max(PREVIEW_MIN_LEFT, Math.min(widest, ratioCap, Math.max(1, previewFloor)));
  }

  /**
   * Preview box for the focused option (cursor's preview when present,
   * else the first preview-bearing option). Width-keyed cache: a width
   * change re-wraps via a fresh Markdown render.
   */
  private previewBlock(st: AnswerState, width: number): string[] {
    if (width < PREVIEW_MIN_BOX_WIDTH) return [];
    const inner = width - 4; // border (2) + inner padding (2)
    let target = st.hasPreviewOption(st.cursor) ? st.cursor : -1;
    if (target < 0) {
      target = st.spec.options.findIndex(
        (o) => typeof o.preview === "string" && o.preview.trim() !== "",
      );
    }
    let lines: string[];
    if (target < 0) {
      lines = [this.theme.fg("dim", "No preview available")];
    } else {
      const key = `${this.tab}:${target}`;
      const hit = this.previewCache.get(key);
      if (hit && hit.width === inner) {
        lines = hit.lines;
      } else {
        const md = new Markdown(st.spec.options[target]!.preview!, 0, 0, this.mdTheme);
        lines = stripFenceMarkers(md.render(inner));
        this.previewCache.set(key, { width: inner, lines });
      }
    }
    const hidden = Math.max(0, lines.length - MAX_PREVIEW_LINES);
    const capped = hidden > 0 ? lines.slice(0, MAX_PREVIEW_LINES) : lines;
    return renderPreviewBox(capped, width, (s) => this.theme.fg("dim", s), hidden);
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
      const noteMark = st.notes.size > 0 ? theme.fg("dim", " (+notes)") : "";
      this.body.addChild(new Text(
        theme.fg("dim", `Q${i + 1} `) + theme.fg("text", spec.question),
        1, 0,
      ));
      this.body.addChild(new Text(theme.fg("accent", "  → ") + val + noteMark, 1, 0));
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
    const base = st.spec.otherLabel ?? OTHER_LABEL;
    return st.otherText !== "" ? `${base}: ${st.otherText}` : base;
  }

  private hintLine(): string {
    const st = this.current();
    if (st.editingOther) return "type answer · Enter save · Esc stop editing";
    if (st.editingNote) return "type note · Enter save (empty clears) · Esc stop editing";
    const tabs = this.multi ? " · ←/→/Tab switch" : "";
    const note = st.hasPreviewOption(st.cursor) ? " · n note" : "";
    if (st.spec.multiSelect) {
      return `↑↓/jk move · 1-9/Space toggle · Enter confirm${note}${tabs} · Esc cancel`;
    }
    return `↑↓/jk navigate · 1-9 select · Enter confirm${note}${tabs} · Esc cancel`;
  }
}
