// ============================================================
// Ask — question spec + answer formatting (pure, no host imports).
//
// Shared by the ask_user_question tool and the permission approval
// dialog: one interaction model (numbered single-select), one spec
// format, one answer formatter. The interactive component itself
// lives in the adapter (ask/dialog.ts, pi-tui).
// ============================================================

export interface OptionSpec {
  label: string;
  description?: string;
}

export interface QuestionSpec {
  question: string;
  options: OptionSpec[];
}

export interface AnsweredQuestion {
  question: string;
  /** The chosen option label, or undefined when the user cancelled. */
  answer?: string;
}

/** Max options shown with digit shortcuts (1-9). */
export const MAX_DIGIT_OPTIONS = 9;

/**
 * Normalize tool input into QuestionSpec[]. Accepts the array form
 * ({ questions: [...] }) and the single-question shorthand
 * ({ question, options }). Options accept strings or {label, description}.
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
    return { question: q.question, options };
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

/**
 * Format collected answers as the tool result text read by the model.
 * Cancelled questions are reported explicitly so the model does not
 * mistake silence for an answer.
 */
export function formatAnswers(answered: AnsweredQuestion[]): string {
  const lines = answered.map((a) =>
    a.answer === undefined
      ? `Q: ${a.question}\nA: (no answer — user cancelled)`
      : `Q: ${a.question}\nA: ${a.answer}`,
  );
  return lines.join("\n\n");
}
