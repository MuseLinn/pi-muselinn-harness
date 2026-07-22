// ask_user_question core logic unit tests (pure, no pi runtime needed).
const {
  normalizeQuestions,
  digitToIndex,
  moveIndex,
  formatAnswers,
  approvalTitleFor,
  AnswerState,
  MAX_DIGIT_OPTIONS,
  MAX_QUESTIONS,
  MAX_HEADER_LEN,
  OTHER_LABEL,
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

// 7. AnswerState — single-select with Other
const s1 = new AnswerState(normalizeQuestions({ question: "Pick", options: ["A", "B"] })[0]);
check("Other appended → 3 options", s1.optionCount === 3);
check("Other index is last", s1.otherIndex === 2 && s1.isOther(2) && !s1.isOther(1));
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
check("multi optionCount includes Other", m1.optionCount === 4);
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
