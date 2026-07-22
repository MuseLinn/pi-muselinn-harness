// ============================================================
// Ask — ask_user_question tool + shared dialog helper (adapter).
//
// The model calls ask_user_question with 1-4 questions (single- or
// multi-select, each with a short header and described options);
// they are shown in one tabbed QuestionDialogComponent and the
// collected answers go back as the tool result. Every question
// automatically offers a free-text "Other" option (customizable via
// other_label/other_description; a long-form body block of up to 12
// lines can carry extra context) and a "Chat about this" row that
// returns kind "chat" instead of an answer. Options may carry a
// markdown `preview` (side-by-side preview pane; `n` attaches a
// per-option note that travels back in answers[].notes). The tool
// result also carries a structured `details` envelope (cancelled /
// chat / answers[].kind/notes) for machine consumers. With
// background: true the question is registered on the shared
// backgroundManager and the tool returns its task_id immediately —
// the answer lands via appendEntry + a completion notification when
// the user responds. In print/RPC mode (no UI) the tool returns the
// questions as text for the user to answer in the next message.
// Permission approval reuses showQuestionDialog (single-select, no
// Other, no previews, no Chat — see index.ts), so its dialog is
// unchanged.
// ============================================================

import {
  backgroundQuestionTaskId,
  backgroundStartText,
  CHAT_LABEL,
  normalizeQuestions,
  formatAnswers,
  OTHER_LABEL,
  questionTaskDescription,
  type AnswerKind,
  type AnswerState,
  type AnsweredQuestion,
  type QuestionSpec,
} from "../packages/core/ask/types";
import { QuestionDialogComponent, type QuestionsDialogResult } from "./dialog";
import { backgroundManager } from "../task/index";

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
    const body = q.body?.trim() ? `\n${q.body.trim()}` : "";
    const opts = q.options.map((o, j) => `  ${j + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`);
    const otherLabel = q.otherLabel ?? OTHER_LABEL;
    opts.push(`  ${q.options.length + 1}. ${otherLabel} — ${q.otherDescription ?? "free-text answer"}`);
    if (q.allowChat) {
      opts.push(`  ${q.options.length + 2}. ${CHAT_LABEL} — discuss this question instead of answering`);
    }
    return `${head}${kind}${body}\n${opts.join("\n")}`;
  });
  return (
    "Interactive UI is not available in this mode. Please ask the user to answer " +
    "in their next message:\n\n" + parts.join("\n\n")
  );
}

/** Build the AnsweredQuestion list from a dialog result. */
function collectAnswers(
  questions: QuestionSpec[],
  result: QuestionsDialogResult,
): AnsweredQuestion[] {
  return questions.map((q, i) => {
    const state: AnswerState | undefined = result.states[i];
    // Keep choices made before an Esc cancel; status records how it ended.
    const answer = state?.answer();
    const notes = state?.answerNotes() ?? [];
    const kind: AnswerKind =
      result.chatIndex === i
        ? "chat"
        : answer !== undefined
          ? "selected"
          : result.cancelled
            ? "cancelled"
            : "skipped";
    const base = { question: q.question, header: q.header, kind, ...(notes.length > 0 ? { notes } : {}) };
    if (answer !== undefined) return { ...base, answer, status: "answered" };
    return { ...base, status: result.cancelled ? "cancelled" : "skipped" };
  });
}

/**
 * Machine-readable details envelope (rpiv response-envelope parity): the
 * text content stays human/model-readable, `details` lets downstream code
 * switch on structured kind/notes without parsing prose.
 */
function answersEnvelope(
  questions: QuestionSpec[],
  result: QuestionsDialogResult,
  answered: AnsweredQuestion[],
) {
  return {
    cancelled: result.cancelled,
    ...(result.chatIndex !== undefined
      ? { chat: { questionIndex: result.chatIndex, question: questions[result.chatIndex]?.question } }
      : {}),
    answers: answered,
  };
}

/**
 * Background mode (kimi-code ask-user.ts parity): register a task on the
 * shared backgroundManager, return its task_id immediately, and let the
 * dialog run without blocking the main loop. When the user answers, the
 * formatted answers land via backgroundManager.complete → appendEntry
 * persistence + completion notification; task_output(task_id) reads them.
 */
function startBackgroundQuestion(ctx: any, questions: QuestionSpec[]) {
  const taskId = backgroundQuestionTaskId();
  const description = questionTaskDescription(questions);
  try {
    backgroundManager.register({
      id: taskId,
      prompt: `Question: ${description}`,
      model: "(question)",
      subagentType: "question",
      status: "running",
      outputLines: [],
      startTime: Date.now(),
      createdAt: Date.now(),
      turns: 0,
      usage: { input: 0, output: 0, cost: 0 },
    });
  } catch (err: any) {
    return { content: [{ type: "text", text: err?.message ?? String(err) }] };
  }

  // Fire-and-forget: do NOT await — the point is to not block the main loop.
  void (async () => {
    try {
      const result = await showQuestionsDialog(ctx, questions);
      // A task_stop while the dialog was open wins: don't resurrect it.
      if (backgroundManager.get(taskId)?.status !== "running") return;
      if (!result) {
        backgroundManager.fail(taskId, "Interactive dialog unavailable; ask the user directly in text instead.");
        return;
      }
      const suffix = result.cancelled ? "\n\n(user cancelled the dialog)" : "";
      backgroundManager.complete(taskId, (formatAnswers(collectAnswers(questions, result)) + suffix).split("\n"));
    } catch (err: any) {
      if (backgroundManager.get(taskId)?.status === "running") {
        backgroundManager.fail(taskId, err?.message ?? String(err));
      }
    }
  })();

  return { content: [{ type: "text", text: backgroundStartText(taskId, description) }] };
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
      "Add option preview (markdown: mockup, code snippet, visual comparison) when seeing the rendered outcome helps the user choose; any preview switches the dialog to a side-by-side layout and lets the user attach per-option notes",
      "Set multi_select: true when several options may apply at once; a free-text Other option is always added automatically",
      "Question texts must be unique per call and option labels unique within a question — duplicates are rejected; labels Other, Chat about this and Submit are reserved",
      "The user may pick Chat about this instead of answering: the answer comes back with kind chat — discuss the question with the user rather than treating it as answered",
      "Set background: true when you can keep working without the answer: returns a task_id immediately and the answer arrives as a background task result — do not poll while it is pending",
      "For purely open-ended input, ask directly in your reply text instead",
    ],
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The question to ask (single-question shorthand)" },
        header: { type: "string", description: "Short tab label for this question (≤12 chars)" },
        multi_select: { type: "boolean", description: "Allow picking several options (checkbox semantics)" },
        body: { type: "string", description: "Optional long-form context shown under the question (first 12 lines rendered)" },
        other_label: { type: "string", description: "Custom label for the free-text Other option (default \"Other\")" },
        other_description: { type: "string", description: "Custom description line for the Other option" },
        background: { type: "boolean", description: "Ask without blocking: returns a task_id immediately; the answer is persisted + notified when the user responds" },
        options: {
          type: "array",
          description: "Options for the single question (2-9 items; strings or {label, description?, preview?} — preview is markdown rendered next to the option list)",
          items: { type: ["string", "object"] },
        },
        questions: {
          type: "array",
          description:
            "1-4 questions shown as tabs: [{question, header, options: [{label, description?, preview?}], multi_select?, body?, other_label?, other_description?}]. " +
            "A free-text \"Other\" option and a \"Chat about this\" row are appended to every question automatically.",
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

      if (params?.background === true) {
        return startBackgroundQuestion(ctx, questions);
      }

      if (!ctx?.hasUI) {
        return { content: [{ type: "text", text: questionsAsText(questions) }] };
      }

      const result = await showQuestionsDialog(ctx, questions);
      if (!result) {
        // Dialog unavailable despite hasUI (custom() threw) — fall back to text.
        return { content: [{ type: "text", text: questionsAsText(questions) }] };
      }
      const answered = collectAnswers(questions, result);
      const suffix = result.cancelled ? "\n\n(user cancelled the dialog)" : "";
      return {
        content: [{ type: "text", text: formatAnswers(answered) + suffix }],
        details: answersEnvelope(questions, result, answered),
      };
    },
  });
}
