// ============================================================
// Ask — ask_user_question tool + shared dialog helper (adapter).
//
// The model calls ask_user_question with 1-4 questions (single- or
// multi-select, each with a short header and described options);
// they are shown in one tabbed QuestionDialogComponent and the
// collected answers go back as the tool result. Every question
// automatically offers a free-text "Other" option. In print/RPC
// mode (no UI) the tool returns the questions as text for the user
// to answer in the next message. Permission approval reuses
// showQuestionDialog (single-select, no Other — see index.ts).
// ============================================================

import {
  normalizeQuestions,
  formatAnswers,
  type AnswerState,
  type AnsweredQuestion,
  type QuestionSpec,
} from "../packages/core/ask/types";
import { QuestionDialogComponent, type QuestionsDialogResult } from "./dialog";

/** Run the tabbed dialog over all questions; undefined = no UI available. */
export async function showQuestionsDialog(
  ctx: any,
  specs: QuestionSpec[],
): Promise<QuestionsDialogResult | undefined> {
  if (!ctx?.hasUI || !ctx?.ui?.custom || specs.length === 0) return undefined;
  try {
    return await ctx.ui.custom(
      (_tui: any, theme: any, _kb: any, done: (r: QuestionsDialogResult) => void) =>
        new QuestionDialogComponent(specs, theme, done),
    );
  } catch {
    return undefined;
  }
}

/**
 * Show one single-select question interactively (permission approval
 * path); undefined = cancelled/no UI.
 */
export async function showQuestionDialog(ctx: any, spec: QuestionSpec): Promise<string | undefined> {
  const result = await showQuestionsDialog(ctx, [spec]);
  if (!result || result.cancelled) return undefined;
  const answer = result.states[0]?.answer();
  if (answer === undefined) return undefined;
  return Array.isArray(answer) ? answer.join(", ") : answer;
}

/** Render questions + options as plain text (no-UI fallback). */
function questionsAsText(questions: QuestionSpec[]): string {
  const parts = questions.map((q, i) => {
    const head = questions.length > 1
      ? `Q${i + 1}${q.header ? ` [${q.header}]` : ""}: ${q.question}`
      : q.question;
    const kind = q.multiSelect ? " (multi-select — pick any number)" : "";
    const opts = q.options.map((o, j) => `  ${j + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
    opts.push(`  ${q.options.length + 1}. Other — free-text answer`);
    return `${head}${kind}\n${opts.join("\n")}`;
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
    promptSnippet: "ask_user_question: ask the user 1-4 structured questions (single/multi select, tabbed dialog)",
    promptGuidelines: [
      "Use ask_user_question when you need the user to pick between concrete options (approaches, targets, yes/no variants)",
      "Ask 1-4 related questions per call; give each a short header (≤12 chars) used as its tab label",
      "Keep options short (2-6) and mutually exclusive; put the recommended option first; use option description for trade-offs",
      "Set multi_select: true when several options may apply at once; a free-text Other option is always added automatically",
      "For purely open-ended input, ask directly in your reply text instead",
    ],
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask (single-question shorthand)" },
        header: { type: "string", description: "Short tab label for this question (≤12 chars)" },
        multi_select: { type: "boolean", description: "Allow picking several options (checkbox semantics)" },
        options: {
          type: "array",
          description: "Options for the single question (2-9 items; strings or {label, description})",
          items: { type: ["string", "object"] },
        },
        questions: {
          type: "array",
          description:
            "1-4 questions shown as tabs: [{question, header, options: [{label, description?}], multi_select?}]. " +
            "A free-text \"Other\" option is appended to every question automatically.",
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

      const result = await showQuestionsDialog(ctx, questions);
      if (!result) {
        // Dialog unavailable despite hasUI (custom() threw) — fall back to text.
        return { content: [{ type: "text", text: questionsAsText(questions) }] };
      }
      const answered: AnsweredQuestion[] = questions.map((q, i) => {
        const state: AnswerState | undefined = result.states[i];
        // Keep choices made before an Esc cancel; status records how it ended.
        const answer = state?.answer();
        if (answer !== undefined) return { question: q.question, header: q.header, answer, status: "answered" };
        return {
          question: q.question,
          header: q.header,
          status: result.cancelled ? "cancelled" : "skipped",
        };
      });
      const suffix = result.cancelled ? "\n\n(user cancelled the dialog)" : "";
      return { content: [{ type: "text", text: formatAnswers(answered) + suffix }] };
    },
  });
}
