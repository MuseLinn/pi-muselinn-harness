// ask_user_question core logic unit tests (pure, no pi runtime needed).
const {
  normalizeQuestions,
  digitToIndex,
  moveIndex,
  formatAnswers,
  approvalTitleFor,
  AnswerState,
  optionWindow,
  bodyLines,
  questionUniquenessError,
  backgroundQuestionTaskId,
  questionTaskDescription,
  backgroundStartText,
  decideLayout,
  hasAnyPreview,
  MAX_DIGIT_OPTIONS,
  MAX_QUESTIONS,
  MAX_HEADER_LEN,
  MAX_VISIBLE_OPTIONS,
  MAX_BODY_LINES,
  OTHER_LABEL,
  CHAT_LABEL,
  SUBMIT_LABEL,
  RESERVED_LABELS,
  PREVIEW_MIN_WIDTH,
} = await import("../packages/core/ask/types.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// 1. Single-question shorthand
const q1 = normalizeQuestions({ question: "Which approach?", options: ["A", "B"] });
check("shorthand → 1 question", q1.length === 1 && q1[0].question === "Which approach?");
check("string options → labels", q1[0].options[0].label === "A" && q1[0].options[1].label === "B");
check("shorthand defaults: single-select + Other", q1[0].multiSelect === false && q1[0].allowOther === true);

// 2. Array form with {label, description} + header + multi_select
const q2 = normalizeQuestions({ questions: [
  { question: "Q1", header: "scope", options: [{ label: "x", description: "dx" }, { label: "y" }] },
  { question: "Q2", header: "pick-many", multi_select: true, options: ["m", "n"] },
] });
check("array → 2 questions", q2.length === 2);
check("option description kept", q2[0].options[0].description === "dx");
check("missing description undefined", q2[0].options[1].description === undefined);
check("header kept", q2[0].header === "scope");
check("multi_select parsed", q2[1].multiSelect === true && q2[0].multiSelect === false);

// 2b. Header truncation to MAX_HEADER_LEN
const q2b = normalizeQuestions({ question: "q", header: "a-very-long-header-name", options: ["a", "b"] });
check("header truncated to 12 chars", q2b[0].header.length === MAX_HEADER_LEN && q2b[0].header === "a-very-long-");

// 3. Invalid input throws (handler turns into error text)
let threw = 0;
try { normalizeQuestions({}); } catch { threw++; }
try { normalizeQuestions({ question: "q" }); } catch { threw++; }
try { normalizeQuestions({ question: "q", options: ["only one"] }); } catch { threw++; }
try { normalizeQuestions({ question: "q", options: ["", "b"] }); } catch { threw++; }
check("4 invalid shapes throw", threw === 4, `threw=${threw}`);

// 3b. Too many questions throws
let threwMax = false;
try {
  normalizeQuestions({ questions: Array.from({ length: MAX_QUESTIONS + 1 }, (_, i) => ({ question: `q${i}`, options: ["a", "b"] })) });
} catch { threwMax = true; }
check(`>${MAX_QUESTIONS} questions throws`, threwMax);
check("exactly MAX_QUESTIONS ok",
  normalizeQuestions({ questions: Array.from({ length: MAX_QUESTIONS }, (_, i) => ({ question: `q${i}`, options: ["a", "b"] })) }).length === MAX_QUESTIONS);

// 4. digitToIndex
check("'1' → 0", digitToIndex("1", 3) === 0);
check("'9' → 8", digitToIndex("9", 9) === 8);
check("'9' rejected when 3 options", digitToIndex("9", 3) === -1);
check("'0' rejected", digitToIndex("0", 3) === -1);
check("multi-char rejected", digitToIndex("12", 3) === -1);
check("letter rejected", digitToIndex("a", 3) === -1);
check("MAX_DIGIT_OPTIONS is 9", MAX_DIGIT_OPTIONS === 9);

// 5. moveIndex clamps
check("move down", moveIndex(0, 1, 3) === 1);
check("clamp at end", moveIndex(2, 1, 3) === 2);
check("clamp at start", moveIndex(0, -1, 3) === 0);
check("empty list → 0", moveIndex(5, 1, 0) === 0);

// 6. AnswerState — single-select without Other (permission shape)
const perm = new AnswerState({ question: "Allow?", options: [{ label: "yes" }, { label: "no" }] });
check("no allowOther → 2 options", perm.optionCount === 2);
check("unanswered initially", perm.answer() === undefined && !perm.isAnswered());
check("activate picks label", perm.activate(1) === "answered" && perm.answer() === "no");
check("out-of-range activate noop", perm.activate(7) === "noop");

// 7. AnswerState — single-select with Other (+ Chat row from the ask tool)
const s1 = new AnswerState(normalizeQuestions({ question: "Pick", options: ["A", "B"] })[0]);
check("Other + Chat appended → 4 options", s1.optionCount === 4);
check("Other index is 2", s1.otherIndex === 2 && s1.isOther(2) && !s1.isOther(1));
check("Chat index is last", s1.chatIndex === 3 && s1.isChat(3) && !s1.isChat(2));
check("activate Other → edit mode", s1.activate(2) === "edit-other" && s1.editingOther === true);
check("empty Other commit rejected", s1.commitOther("   ") === false && s1.editingOther === true);
check("Other commit answers with text", s1.commitOther("custom plan") === true && s1.answer() === "custom plan");
check("Other committed → selected", s1.isSelected(2) && s1.editingOther === false);
check("cancelOtherEdit clears flag", (() => { s1.editingOther = true; s1.cancelOtherEdit(); return s1.editingOther === false; })());
check("preset after Other replaces answer", (s1.activate(0), s1.answer() === "A"));

// 8. AnswerState — multi-select state machine
const m1 = new AnswerState(normalizeQuestions({
  question: "Pick many", multi_select: true, options: ["a", "b", "c"],
})[0]);
check("multi optionCount includes Other + Chat", m1.optionCount === 5);
check("toggle adds", m1.toggle(0) === "toggled" && m1.isSelected(0));
check("toggle twice removes", (m1.toggle(0), !m1.isSelected(0)) && m1.answer() === undefined);
check("multi answer is array", (m1.toggle(0), m1.toggle(2), JSON.stringify(m1.answer()) === JSON.stringify(["a", "c"])));
check("multi answer preserves option order", (m1.toggle(1), JSON.stringify(m1.answer()) === JSON.stringify(["a", "b", "c"])));
check("space on Other → edit mode", m1.toggle(3) === "edit-other" && m1.editingOther === true);
check("Other text joins multi answer", (m1.commitOther("d!"), JSON.stringify(m1.answer()) === JSON.stringify(["a", "b", "c", "d!"])));
check("toggle checked Other removes it", (m1.toggle(3), JSON.stringify(m1.answer()) === JSON.stringify(["a", "b", "c"])));
check("activate Other re-enters edit", m1.activate(3) === "edit-other");
m1.cancelOtherEdit();

// 9. formatAnswers — answered / multi array / skipped / cancelled
const text = formatAnswers([
  { question: "Q1", answer: "A" },
  { question: "Q2", answer: undefined },
]);
check("answered formatted", text.includes("Q1: Q1") && text.includes("A: A"));
check("legacy undefined → cancel mark", text.includes("user cancelled"));
check("no cancel → no mark", !formatAnswers([{ question: "Q", answer: "x" }]).includes("cancelled"));

const text2 = formatAnswers([
  { question: "Solo", header: "s", answer: ["a", "b"], status: "answered" },
]);
check("multi answer → JSON array", text2.includes('A: ["a", "b"]'));
check("single question keeps bare Q:", text2.startsWith("Q: Solo [s]"));

const text3 = formatAnswers([
  { question: "One", answer: "x", status: "answered" },
  { question: "Two", status: "skipped" },
  { question: "Three", status: "cancelled" },
]);
check("skipped vs cancelled distinct",
  text3.includes("Q2: Two\nA: (no answer — skipped by user)") &&
  text3.includes("Q3: Three\nA: (no answer — user cancelled)"));

// 10. approvalTitleFor (per-tool approval titles)
check("bash title", approvalTitleFor("bash") === "Run this command?");
check("edit title", approvalTitleFor("edit") === "Apply these edits?");
check("write title", approvalTitleFor("write") === "Write this file?");
check("unknown tool fallback", approvalTitleFor("webfetch") === "Run webfetch?");

// 11. constants
check("OTHER_LABEL is Other", OTHER_LABEL === "Other");
check("MAX_QUESTIONS is 4", MAX_QUESTIONS === 4);
check("MAX_HEADER_LEN is 12", MAX_HEADER_LEN === 12);
check("MAX_VISIBLE_OPTIONS is 6", MAX_VISIBLE_OPTIONS === 6);
check("MAX_BODY_LINES is 12", MAX_BODY_LINES === 12);

// 12. optionWindow — scrolled visible window (kimi-code maxVisibleOptions parity)
check("short list → full window", (() => {
  const w = optionWindow(0, 3);
  return w.start === 0 && w.end === 3 && w.hiddenAbove === 0 && w.hiddenBelow === 0;
})());
check("exactly maxVisible → full window", (() => {
  const w = optionWindow(5, 6);
  return w.start === 0 && w.end === 6 && w.hiddenAbove === 0 && w.hiddenBelow === 0;
})());
check("cursor at top of long list → window at 0", (() => {
  const w = optionWindow(0, 10);
  return w.start === 0 && w.end === 6 && w.hiddenAbove === 0 && w.hiddenBelow === 4;
})());
check("cursor centered mid-list", (() => {
  const w = optionWindow(5, 10);
  return w.start === 2 && w.end === 8 && w.hiddenAbove === 2 && w.hiddenBelow === 2;
})());
check("cursor at bottom clamps window to end", (() => {
  const w = optionWindow(9, 10);
  return w.start === 4 && w.end === 10 && w.hiddenAbove === 4 && w.hiddenBelow === 0;
})());
check("window never exceeds maxVisible rows", (() => {
  for (let c = 0; c < 15; c++) {
    const w = optionWindow(c, 15);
    if (w.end - w.start > MAX_VISIBLE_OPTIONS) return false;
    if (c < w.start || c >= w.end) return false; // cursor always visible
  }
  return true;
})());
check("empty/tiny inputs safe", (() => {
  const w = optionWindow(3, 0);
  return w.start === 0 && w.end === 0 && w.hiddenAbove === 0 && w.hiddenBelow === 0;
})());
check("custom maxVisible honored", (() => {
  const w = optionWindow(7, 12, 4);
  return w.end - w.start === 4 && w.start <= 7 && 7 < w.end;
})());

// 13. uniqueness validation (kimi-code ask-user parity)
check("duplicate question text rejected", (() => {
  try {
    normalizeQuestions({ questions: [
      { question: "Same?", options: ["a", "b"] },
      { question: "Same?", options: ["c", "d"] },
    ] });
    return false;
  } catch (e) { return /duplicate question text/.test(e.message) && /unique/.test(e.message); }
})());
check("duplicate option label rejected", (() => {
  try {
    normalizeQuestions({ question: "Pick", options: ["x", "y", "x"] });
    return false;
  } catch (e) { return /duplicate option label/.test(e.message) && /"x"/.test(e.message); }
})());
check("same label in different questions ok",
  normalizeQuestions({ questions: [
    { question: "Q one", options: ["yes", "no"] },
    { question: "Q two", options: ["yes", "no"] },
  ] }).length === 2);
check("questionUniquenessError null when unique",
  questionUniquenessError(normalizeQuestions({ question: "q", options: ["a", "b"] })) === null);
check("questionUniquenessError reports the label", (() => {
  const specs = [{ question: "q", options: [{ label: "d" }, { label: "d" }] }];
  const err = questionUniquenessError(specs);
  return err !== null && err.includes('"d"');
})());

// 14. background-mode helpers (pure part; adapter flow needs pi runtime)
check("task id has ask- prefix", /^ask-[a-z0-9]+-[a-z0-9]+$/.test(backgroundQuestionTaskId()));
check("task id embeds the timestamp", backgroundQuestionTaskId(0, "zzzz") === "ask-0-zzzz");
check("description single question", questionTaskDescription(normalizeQuestions({ question: "Deploy now?", options: ["y", "n"] })) === "Deploy now?");
check("description multi question counts rest",
  questionTaskDescription(normalizeQuestions({ questions: [
    { question: "First?", options: ["a", "b"] },
    { question: "Second?", options: ["a", "b"] },
    { question: "Third?", options: ["a", "b"] },
  ] })) === "First? (+2 more)");
check("start text carries task_id + status", (() => {
  const t = backgroundStartText("ask-x1-y2", "Deploy now?");
  return t.includes("task_id: ask-x1-y2") && t.includes("status: running") &&
    t.includes("description: Deploy now?") && t.includes("task_output");
})());

// 15. body + custom Other (P3)
check("body parsed", normalizeQuestions({ question: "q", options: ["a", "b"], body: "line1\nline2" })[0].body === "line1\nline2");
check("blank body dropped", normalizeQuestions({ question: "q", options: ["a", "b"], body: "   " })[0].body === undefined);
check("other_label parsed", normalizeQuestions({ question: "q", options: ["a", "b"], other_label: "自定义" })[0].otherLabel === "自定义");
check("other_description parsed", normalizeQuestions({ question: "q", options: ["a", "b"], other_description: "free text" })[0].otherDescription === "free text");
check("camelCase other fields accepted",
  normalizeQuestions({ question: "q", options: ["a", "b"], otherLabel: "Mine", otherDescription: "d" })[0].otherLabel === "Mine");
check("bodyLines empty for missing body", (() => {
  const b = bodyLines(undefined);
  return b.lines.length === 0 && b.hidden === 0;
})());
check("bodyLines under cap keeps all", (() => {
  const b = bodyLines("a\nb\nc");
  return b.lines.length === 3 && b.hidden === 0;
})());
check("bodyLines caps at MAX_BODY_LINES", (() => {
  const b = bodyLines(Array.from({ length: 20 }, (_, i) => `L${i}`).join("\n"));
  return b.lines.length === MAX_BODY_LINES && b.hidden === 8 && b.lines[0] === "L0" && b.lines[11] === "L11";
})());
check("bodyLines trims surrounding whitespace", (() => {
  const b = bodyLines("  \nhello\n  ");
  return b.lines.length === 1 && b.lines[0] === "hello";
})());

// 16. option preview parsing (rpiv parity)
check("preview parsed", (() => {
  const q = normalizeQuestions({ question: "q", options: [{ label: "a", preview: "# Plan\n```ts\nx\n```" }, "b"] })[0];
  return q.options[0].preview === "# Plan\n```ts\nx\n```" && q.options[1].preview === undefined;
})());
check("blank preview dropped",
  normalizeQuestions({ question: "q", options: [{ label: "a", preview: "   " }, "b"] })[0].options[0].preview === undefined);
check("ask tool enables chat row", normalizeQuestions({ question: "q", options: ["a", "b"] })[0].allowChat === true);

// 17. hasAnyPreview + decideLayout (pure layout decision)
check("hasAnyPreview true when any option has preview", (() => {
  const q = normalizeQuestions({ question: "q", options: [{ label: "a", preview: "x" }, "b"] })[0];
  return hasAnyPreview(q) === true;
})());
check("hasAnyPreview false without previews",
  hasAnyPreview(normalizeQuestions({ question: "q", options: ["a", "b"] })[0]) === false);
check("PREVIEW_MIN_WIDTH is 100", PREVIEW_MIN_WIDTH === 100);
check("wide + preview → side-by-side", decideLayout(100, true) === "side-by-side" && decideLayout(160, true) === "side-by-side");
check("narrow terminal → stacked degrade", decideLayout(99, true) === "stacked" && decideLayout(80, true) === "stacked");
check("no preview → stacked even when wide", decideLayout(200, false) === "stacked");

// 18. reserved labels (rpiv reserved_label guard parity)
check("CHAT_LABEL / SUBMIT_LABEL constants", CHAT_LABEL === "Chat about this" && SUBMIT_LABEL === "Submit");
check("RESERVED_LABELS covers Other/Chat/Submit",
  RESERVED_LABELS.includes("Other") && RESERVED_LABELS.includes("Chat about this") && RESERVED_LABELS.includes("Submit"));
check("reserved label Other rejected", (() => {
  try { normalizeQuestions({ question: "q", options: ["Other", "b"] }); return false; }
  catch (e) { return /reserved option label/.test(e.message) && /"Other"/.test(e.message); }
})());
check("reserved label Chat about this rejected", (() => {
  try { normalizeQuestions({ question: "q", options: ["Chat about this", "b"] }); return false; }
  catch (e) { return /reserved option label/.test(e.message); }
})());
check("reserved label Submit rejected", (() => {
  try { normalizeQuestions({ question: "q", options: ["Submit", "b"] }); return false; }
  catch (e) { return /reserved option label/.test(e.message); }
})());
check("custom other_label reserved too", (() => {
  try { normalizeQuestions({ question: "q", options: ["Mine", "b"], other_label: "Mine" }); return false; }
  catch (e) { return /reserved option label/.test(e.message) && /"Mine"/.test(e.message); }
})());
check("reserved short-circuits before duplicate", (() => {
  try { normalizeQuestions({ question: "q", options: ["Other", "Other"] }); return false; }
  catch (e) { return /reserved option label/.test(e.message) && !/duplicate/.test(e.message); }
})());
check("lowercase other is an ordinary label",
  normalizeQuestions({ question: "q", options: ["other", "b"] })[0].options[0].label === "other");

// 19. Chat row state machine
const c1 = new AnswerState(normalizeQuestions({ question: "Pick", options: ["A", "B"] })[0]);
check("permission shape has no chat row", (() => {
  const p = new AnswerState({ question: "Allow?", options: [{ label: "yes" }, { label: "no" }] });
  return p.optionCount === 2 && !p.isChat(0) && !p.isChat(1) && p.chatIndex === 2;
})());
check("activate chat → chat", c1.activate(c1.chatIndex) === "chat" && c1.answer() === undefined);
check("chat does not select an answer", !c1.isAnswered() && c1.single === undefined);
check("cursor moved to chat row", c1.cursor === c1.chatIndex);
check("chat without allowChat → noop", (() => {
  const p = new AnswerState({ question: "q", options: [{ label: "a" }, { label: "b" }] });
  return p.activate(2) === "noop";
})());
check("multi Space on chat row → noop", m1.toggle(m1.chatIndex) === "noop");

// 20. per-option notes (n key on preview-bearing options)
const n1 = new AnswerState(normalizeQuestions({
  question: "q",
  options: [{ label: "a", preview: "preview A" }, { label: "b" }, { label: "c", preview: "preview C" }],
})[0]);
check("hasPreviewOption only for preview options",
  n1.hasPreviewOption(0) && !n1.hasPreviewOption(1) && n1.hasPreviewOption(2) && !n1.hasPreviewOption(3) /* Other */ && !n1.hasPreviewOption(4) /* Chat */);
check("startNoteEdit rejects non-preview option", n1.startNoteEdit(1) === false && n1.editingNote === false);
check("startNoteEdit opens editor", n1.startNoteEdit(0) === true && n1.editingNote === true && n1.noteTarget === 0 && n1.cursor === 0);
check("commitNote stores text", (n1.commitNote("  looks risky  "), n1.notes.get(0) === "looks risky" && n1.editingNote === false && n1.noteTarget === -1));
check("notes on second preview option", (n1.startNoteEdit(2), n1.commitNote("prefer this"), n1.notes.get(2) === "prefer this"));
check("answerNotes in option order with labels", (() => {
  const notes = n1.answerNotes();
  return notes.length === 2 && notes[0].option === "a" && notes[0].text === "looks risky" &&
    notes[1].option === "c" && notes[1].text === "prefer this";
})());
check("empty commit clears the note", (n1.startNoteEdit(0), n1.commitNote("   "), n1.notes.has(0) === false && n1.answerNotes().length === 1));
check("cancelNoteEdit keeps stored notes", (() => {
  n1.startNoteEdit(2); n1.cancelNoteEdit();
  return n1.editingNote === false && n1.noteTarget === -1 && n1.notes.get(2) === "prefer this";
})());

// 21. formatAnswers — kind chat + notes lines
check("chat kind without answer", (() => {
  const t = formatAnswers([{ question: "Q", kind: "chat", status: "skipped" }]);
  return t.includes("A: (no answer — user wants to chat about this question)");
})());
check("chat kind with answer appends note", (() => {
  const t = formatAnswers([{ question: "Q", answer: "A", status: "answered", kind: "chat" }]);
  return t.includes("A: A") && t.includes("(user also wants to chat about this question)");
})());
check("notes render as N: lines", (() => {
  const t = formatAnswers([{ question: "Q", answer: "a", status: "answered", kind: "selected", notes: [{ option: "a", text: "risky" }, { option: "c", text: "nice" }] }]);
  return t.includes("N: [a] risky") && t.includes("N: [c] nice");
})());
check("no notes → no N: lines", !formatAnswers([{ question: "Q", answer: "a" }]).includes("N:"));
check("legacy no-kind output unchanged", (() => {
  const t = formatAnswers([{ question: "Q", answer: undefined, status: "skipped" }]);
  return t.includes("A: (no answer — skipped by user)") && !t.includes("chat");
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
