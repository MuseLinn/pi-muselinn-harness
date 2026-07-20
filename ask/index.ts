// ============================================================
// Ask — ask_user_question tool + shared dialog helper (adapter).
//
// The model calls ask_user_question with one or more numbered
// single-select questions; each is shown interactively via
// QuestionDialogComponent and the collected answers go back as the
// tool result. In print/RPC mode (no UI) the tool returns the
// questions as text for the user to answer in the next message.
// Permission approval reuses showQuestionDialog (see permission/index).
// ============================================================

import { normalizeQuestions, formatAnswers, type AnsweredQuestion, type QuestionSpec } from "../packages/core/ask/types";
import { QuestionDialogComponent } from "./dialog";

/** Show one numbered question interactively; undefined = cancelled/no UI. */
export async function showQuestionDialog(ctx: any, spec: QuestionSpec): Promise<string | undefined> {
  if (!ctx?.hasUI || !ctx?.ui?.custom) return undefined;
  try {
    return await ctx.ui.custom(
      (_tui: any, theme: any, _kb: any, done: (r: string | undefined) => void) =>
        new QuestionDialogComponent(spec, theme, done),
    );
  } catch {
    return undefined;
  }
}

/** Render questions + options as plain text (no-UI fallback). */
function questionsAsText(questions: QuestionSpec[]): string {
  const parts = questions.map((q) => {
    const opts = q.options.map((o, i) => `  ${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
    return `${q.question}\n${opts.join("\n")}`;
  });
  return (
    "Interactive UI is not available in this mode. Please ask the user to answer " +
    "in their next message:\n\n" + parts.join("\n\n")
  );
}

export function registerAskUserQuestion(pi: any): void {
  pi.registerTool({
    name: "ask_user_question",
    label: "Ask User Question",
    promptSnippet: "ask_user_question: ask the user a numbered single-select question",
    promptGuidelines: [
      "Use ask_user_question when you need the user to pick between concrete options (approaches, targets, yes/no variants)",
      "Keep options short (2-6) and mutually exclusive; put the recommended option first",
      "For open-ended input, ask directly in your reply text instead",
    ],
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask (single-question shorthand)" },
        options: {
          type: "array",
          description: "Options for the single question (2-9 items; strings or {label, description})",
          items: { type: ["string", "object"] },
        },
        questions: {
          type: "array",
          description: "Multiple questions, asked in sequence: [{question, options}]",
          items: { type: "object" },
        },
      },
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      let questions: QuestionSpec[];
      try {
        questions = normalizeQuestions(params);
      } catch (err: any) {
        return { content: [{ type: "text", text: err?.message ?? String(err) }] };
      }

      if (!ctx?.hasUI) {
        return { content: [{ type: "text", text: questionsAsText(questions) }] };
      }

      const answered: AnsweredQuestion[] = [];
      for (const q of questions) {
        const answer = await showQuestionDialog(ctx, q);
        answered.push({ question: q.question, answer });
        if (answer === undefined) break; // cancelled — stop asking further questions
      }
      return { content: [{ type: "text", text: formatAnswers(answered) }] };
    },
  });
}
