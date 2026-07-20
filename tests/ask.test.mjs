// ask_user_question core logic unit tests (pure, no pi runtime needed).
const {
  normalizeQuestions,
  digitToIndex,
  moveIndex,
  formatAnswers,
  approvalTitleFor,
  MAX_DIGIT_OPTIONS,
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

// 2. Array form with {label, description}
const q2 = normalizeQuestions({ questions: [
  { question: "Q1", options: [{ label: "x", description: "dx" }, { label: "y" }] },
  { question: "Q2", options: ["m", "n"] },
] });
check("array → 2 questions", q2.length === 2);
check("option description kept", q2[0].options[0].description === "dx");
check("missing description undefined", q2[0].options[1].description === undefined);

// 3. Invalid input throws (handler turns into error text)
let threw = 0;
try { normalizeQuestions({}); } catch { threw++; }
try { normalizeQuestions({ question: "q" }); } catch { threw++; }
try { normalizeQuestions({ question: "q", options: ["only one"] }); } catch { threw++; }
try { normalizeQuestions({ question: "q", options: ["", "b"] }); } catch { threw++; }
check("4 invalid shapes throw", threw === 4, `threw=${threw}`);

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

// 6. formatAnswers
const text = formatAnswers([
  { question: "Q1", answer: "A" },
  { question: "Q2", answer: undefined },
]);
check("answered formatted", text.includes("Q: Q1") && text.includes("A: A"));
check("cancel marked", text.includes("user cancelled"));
check("no cancel → no mark", !formatAnswers([{ question: "Q", answer: "x" }]).includes("cancelled"));

// 7. approvalTitleFor (per-tool approval titles)
check("bash title", approvalTitleFor("bash") === "Run this command?");
check("edit title", approvalTitleFor("edit") === "Apply these edits?");
check("write title", approvalTitleFor("write") === "Write this file?");
check("unknown tool fallback", approvalTitleFor("webfetch") === "Run webfetch?");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
