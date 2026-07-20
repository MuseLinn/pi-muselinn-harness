// ============================================================
// Ask — interactive question dialog (adapter, pi-tui).
//
// Single-select numbered list: ↑↓/j/k navigate, Enter confirm, digit
// keys 1-9 jump straight to an option, Esc cancels. Rendered through
// ctx.ui.custom(); the same component backs the ask_user_question tool
// and the permission approval flow.
// ============================================================

import { Container, Spacer, Text } from "@earendil-works/pi-tui";

import { digitToIndex, moveIndex, type QuestionSpec, MAX_DIGIT_OPTIONS } from "../packages/core/ask/types";

export class QuestionDialogComponent extends Container {
  private selectedIndex = 0;
  private readonly listContainer: Container;
  private readonly onDone: (answer: string | undefined) => void;

  constructor(
    private readonly spec: QuestionSpec,
    private readonly theme: any,
    onDone: (answer: string | undefined) => void,
  ) {
    super();
    this.onDone = onDone;

    this.addChild(new Text(theme.fg("accent", theme.bold(`? ${spec.question}`)), 1, 0));
    this.addChild(new Spacer(1));
    this.listContainer = new Container();
    this.addChild(this.listContainer);
    this.addChild(new Spacer(1));
    this.addChild(new Text(
      theme.fg("dim", "↑↓/jk navigate · 1-9 select · Enter confirm · Esc cancel"),
      1, 0,
    ));
    this.updateList();
  }

  private updateList(): void {
    this.listContainer.clear();
    const theme = this.theme;
    for (let i = 0; i < this.spec.options.length; i++) {
      const opt = this.spec.options[i];
      const isSelected = i === this.selectedIndex;
      const num = i < MAX_DIGIT_OPTIONS ? theme.fg("dim", `${i + 1}. `) : "   ";
      const line = isSelected
        ? theme.fg("accent", "→ ") + num + theme.fg("accent", theme.bold(opt.label))
        : "  " + num + theme.fg("text", opt.label);
      this.listContainer.addChild(new Text(line, 1, 0));
      if (opt.description) {
        this.listContainer.addChild(new Text(theme.fg("dim", `     ${opt.description}`), 1, 0));
      }
    }
  }

  handleInput(keyData: string): void {
    const count = this.spec.options.length;
    // Digit direct select (1-9)
    const digit = digitToIndex(keyData, count);
    if (digit >= 0) {
      this.selectedIndex = digit;
      this.onDone(this.spec.options[digit].label);
      return;
    }
    if (keyData === "\x1b[A" || keyData === "k") {
      this.selectedIndex = moveIndex(this.selectedIndex, -1, count);
      this.updateList();
      return;
    }
    if (keyData === "\x1b[B" || keyData === "j") {
      this.selectedIndex = moveIndex(this.selectedIndex, 1, count);
      this.updateList();
      return;
    }
    if (keyData === "\r" || keyData === "\n") {
      this.onDone(this.spec.options[this.selectedIndex]?.label);
      return;
    }
    if (keyData === "\x1b" || keyData === "q") {
      this.onDone(undefined);
      return;
    }
  }
}
