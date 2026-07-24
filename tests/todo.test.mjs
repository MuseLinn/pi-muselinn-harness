// todo phase model unit tests (pure, no pi runtime needed).
const {
  applyOp,
  applyOpsToPhases,
  clonePhases,
  summarizePhases,
  formatSummary,
  selectVisibleTodos,
  phaseRomanNumeral,
  formatPhaseDisplayName,
  phasesToMarkdown,
  markdownToPhases,
  MAX_VISIBLE_TODOS,
} = await import("../packages/core/todo/types.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

function makePhases() {
  return [
    { name: "Scanner", tasks: [
      { content: "Create claude-scanner", status: "in_progress" },
      { content: "Create codex-scanner", status: "pending" },
    ]},
    { name: "Picker", tasks: [
      { content: "Build picker UI", status: "pending" },
      { content: "Add search", status: "pending" },
      { content: "Style results", status: "pending" },
    ]},
  ];
}

// ── 1. init ────────────────────────────────────────────────────

const r1 = applyOp([], { op: "init", list: [{ phase: "Setup", items: ["install deps", "config"] }] });
check("init: creates phase", r1.phases.length === 1 && r1.phases[0].name === "Setup");
check("init: creates tasks", r1.phases[0].tasks.length === 2);
check("init: first in_progress rest pending", r1.phases[0].tasks[0].status === "in_progress" && r1.phases[0].tasks[1].status === "pending");
check("init: no errors", r1.errors.length === 0);

// Init with flat items fallback
const r2 = applyOp([], { op: "init", items: ["task a", "task b"] });
check("init flat: creates Tasks phase", r2.phases.length === 1 && r2.phases[0].name === "Tasks");
check("init flat: 2 tasks", r2.phases[0].tasks.length === 2);

// Init with flat items + custom phase
const r3 = applyOp([], { op: "init", items: ["x"], phase: "MyPhase" });
check("init flat+phase: custom name", r3.phases[0].name === "MyPhase");

// Init: missing list
const r4 = applyOp([], { op: "init" });
check("init: error on missing list", r4.errors.length > 0);

// Init: duplicate phase
const r5 = applyOp([], { op: "init", list: [{ phase: "A", items: ["1"] }, { phase: "A", items: ["2"] }] });
check("init: duplicate phase error", r5.errors.length > 0 && r5.phases.length === 0);

// Init: duplicate task
const r6 = applyOp([], { op: "init", list: [{ phase: "A", items: ["same", "same"] }] });
check("init: duplicate task error", r6.errors.length > 0);

// Init: empty content trimmed
const r7 = applyOp([], { op: "init", list: [{ phase: "A", items: ["valid", "", "  "] }] });
check("init: empty content errors", r7.errors.length > 0);

// ── 2. start ───────────────────────────────────────────────────

const p1 = makePhases();
const r8 = applyOp(p1, { op: "start", task: "Create codex-scanner" });
check("start: marks in_progress", r8.phases[0].tasks[1].status === "in_progress");
check("start: de-escalates others", r8.phases[0].tasks[0].status === "pending");
check("start: preserves other phases", r8.phases[1].tasks[0].status === "pending");

// Start non-existent
const r9 = applyOp(p1, { op: "start", task: "nonexistent" });
check("start: not found error", r9.errors.length > 0);

// Start missing task
const r10 = applyOp(p1, { op: "start" });
check("start: missing task error", r10.errors.length > 0);

// ── 3. done ────────────────────────────────────────────────────

const p2 = makePhases();
const r11 = applyOp(p2, { op: "done", task: "Create claude-scanner" });
check("done: marks completed", r11.phases[0].tasks[0].status === "completed");

// Done all (no task/phase)
const p3 = makePhases();
const r12 = applyOp(p3, { op: "done" });
check("done all: marks everything completed",
  r12.phases.every(p => p.tasks.every(t => t.status === "completed")));

// Done phase
const p4 = makePhases();
const r13 = applyOp(p4, { op: "done", phase: "Scanner" });
check("done phase: Scanner tasks completed", r13.phases[0].tasks.every(t => t.status === "completed"));
check("done phase: Picker untouched", r13.phases[1].tasks.some(t => t.status === "pending"));

// ── 4. drop (abandon) ──────────────────────────────────────────

const p5 = makePhases();
const r14 = applyOp(p5, { op: "drop", task: "Create claude-scanner" });
check("drop: marks abandoned", r14.phases[0].tasks[0].status === "abandoned");

// Drop phase
const p6 = makePhases();
const r15 = applyOp(p6, { op: "drop", phase: "Picker" });
check("drop phase: all Picker abandoned", r15.phases[1].tasks.every(t => t.status === "abandoned"));

// ── 5. rm (remove) ─────────────────────────────────────────────

const p7 = makePhases();
const r16 = applyOp(p7, { op: "rm", task: "Create claude-scanner" });
check("rm task: removes task", r16.phases[0].tasks.length === 1);
check("rm task: correct task kept", r16.phases[0].tasks[0].content === "Create codex-scanner");

// Rm phase
const p8 = makePhases();
const r17 = applyOp(p8, { op: "rm", phase: "Scanner" });
check("rm phase: removes Scanner", r17.phases.length === 1);
check("rm phase: Picker stays", r17.phases[0].name === "Picker");

// Rm all (no task/phase)
const p9 = makePhases();
const r18 = applyOp(p9, { op: "rm" });
check("rm all: empty phases", r18.phases.length === 0);

// ── 6. append ──────────────────────────────────────────────────

const p10 = makePhases();
const r19 = applyOp(p10, { op: "append", phase: "Scanner", items: ["new task"] });
check("append: adds to existing phase", r19.phases[0].tasks.length === 3);
check("append: new task is pending", r19.phases[0].tasks[2].status === "pending");

// Append to new phase
const p11 = makePhases();
const r20 = applyOp(p11, { op: "append", phase: "NewPhase", items: ["first item"] });
check("append: creates new phase", r20.phases.length === 3);
check("append: new phase name", r20.phases[2].name === "NewPhase");
// Append duplicate
const p12 = makePhases();
const r21 = applyOp(p12, { op: "append", phase: "Scanner", items: ["Create claude-scanner"] });
check("append: duplicate error", r21.errors.length > 0);

// Append missing phase
const r22 = applyOp(p12, { op: "append", items: ["x"] });
check("append: missing phase error", r22.errors.length > 0);

// ── 7. view ────────────────────────────────────────────────────

const p13 = makePhases();
const r23 = applyOp(p13, { op: "view" });
check("view: clones phases", r23.phases.length === 2);
check("view: content preserved", r23.phases[0].tasks[0].content === "Create claude-scanner");
check("view: no mutations", p13[0].tasks[0].content === "Create claude-scanner");

// ── 8. summarizePhases ─────────────────────────────────────────

// makePhases has 1 in_progress, 4 pending
const s = summarizePhases(makePhases());
check("summarize: counts", s.in_progress === 1 && s.pending === 4 && s.completed === 0 && s.abandoned === 0);

// Complete a task and re-summarize
const pDone = applyOp(makePhases(), { op: "done", task: "Create claude-scanner" });
const s2 = summarizePhases(pDone.phases);
check("summarize: after done", s2.completed === 1 && s2.in_progress === 1);

// ── 9. formatSummary ───────────────────────────────────────────

const p14 = makePhases();
const summary = formatSummary(p14, []);
check("formatSummary: contains phase name", summary.includes("Scanner"));
check("formatSummary: contains overall", summary.includes("Overall"));
check("formatSummary: contains Remaining", summary.includes("Remaining"));

const emptySummary = formatSummary([], []);
check("formatSummary: empty list", emptySummary === "Todo list cleared.");

// ── 10. selectVisibleTodos ─────────────────────────────────────

const short = [{ name: "P", tasks: [{ content: "a", status: "pending" }, { content: "b", status: "completed" }] }];
const v1 = selectVisibleTodos(short);
check("selectVisible: short list passes all", v1.rows.length === 2 && v1.hidden === 0);

// Long list (>5)
const manyTasks = [
  { name: "P", tasks: [
    { content: "a", status: "pending" },
    { content: "b", status: "pending" },
    { content: "c", status: "pending" },
    { content: "d", status: "in_progress" },
    { content: "e", status: "pending" },
    { content: "f", status: "pending" },
    { content: "g", status: "completed" },
  ]},
];
const v2 = selectVisibleTodos(manyTasks);
check("selectVisible: max 5", v2.rows.length <= MAX_VISIBLE_TODOS);
check("selectVisible: in_progress visible", v2.rows.some(t => t.status === "in_progress"));
check("selectVisible: hidden count correct", v2.hidden === manyTasks[0].tasks.length - v2.rows.length);

// ── 11. phaseRomanNumeral ──────────────────────────────────────

check("roman: 1=I", phaseRomanNumeral(1) === "I");
check("roman: 4=IV", phaseRomanNumeral(4) === "IV");
check("roman: 5=V", phaseRomanNumeral(5) === "V");
check("roman: 9=IX", phaseRomanNumeral(9) === "IX");
check("roman: 10=X", phaseRomanNumeral(10) === "X");
check("roman: 14=XIV", phaseRomanNumeral(14) === "XIV");
check("roman: 20=XX", phaseRomanNumeral(20) === "XX");
check("roman: 49=XLIX", phaseRomanNumeral(49) === "XLIX");
check("roman: 50=L", phaseRomanNumeral(50) === "L");
check("roman: 99=XCIX", phaseRomanNumeral(99) === "XCIX");
check("roman: 100=C", phaseRomanNumeral(100) === "C");
check("roman: >100 numeric", phaseRomanNumeral(101) === "101");
check("roman: 0 numeric", phaseRomanNumeral(0) === "0");

// ── 12. formatPhaseDisplayName ─────────────────────────────────

check("formatDisplayName: works", formatPhaseDisplayName("Setup", 1) === "I. Setup");
check("formatDisplayName: index 3", formatPhaseDisplayName("Test", 3) === "III. Test");

// ── 13. markdown round-trip ────────────────────────────────────

const p15 = makePhases();
const md = phasesToMarkdown(p15);
check("markdown: contains Scanner heading", md.includes("# Scanner"));
check("markdown: contains task", md.includes("Create claude-scanner"));
check("markdown: uses markers", md.includes("[ ]") || md.includes("[/]"));

const parsed = markdownToPhases(md);
check("markdown round-trip: same phase count", parsed.phases.length === 2);
check("markdown round-trip: tasks restored", parsed.phases[0].tasks.length === 2);

// ── 14. applyOpsToPhases (batch) ───────────────────────────────

const p16 = makePhases();
const batch = applyOpsToPhases(p16, [
  { op: "start", task: "Build picker UI" },
  { op: "done", task: "Create claude-scanner" },
]);
check("batch: start applied", batch.phases[1].tasks[0].status === "in_progress");
check("batch: done applied", batch.phases[0].tasks[0].status === "completed");
check("batch: no errors", batch.errors.length === 0);

// Batch with error rolls back
const p17 = makePhases();
const batchErr = applyOpsToPhases(p17, [
  { op: "done", task: "Create claude-scanner" },
  { op: "start", task: "nonexistent" },
]);
check("batch error: rolls back", batchErr.errors.length > 0);
check("batch error: original unchanged", batchErr.phases === p17);

// ── 15. clonePhases immutability ───────────────────────────────

const p18 = makePhases();
const cloned = clonePhases(p18);
cloned[0].name = "Hacked";
check("clone: original name unchanged", p18[0].name === "Scanner");
cloned[0].tasks[0].status = "completed";
check("clone: original status unchanged", p18[0].tasks[0].status === "in_progress");

// ── 16. Error edge cases ───────────────────────────────────────

check("unknown op error", applyOp([], { op: "invalid" }).errors.length > 0);
check("rm missing task error", applyOp(makePhases(), { op: "rm", task: "nope" }).errors.length > 0);
check("rm missing phase error", applyOp(makePhases(), { op: "rm", phase: "Nope" }).errors.length > 0);
check("done missing task not found", applyOp(makePhases(), { op: "done", task: "nope" }).errors.length > 0);

// ── 17. add_notes ──────────────────────────────────────────────

const p19 = makePhases();
const n1 = applyOp(p19, { op: "add_notes", task: "Create claude-scanner", notes: ["needs more thought", "check API docs"] });
check("add_notes: success", n1.errors.length === 0 && n1.phases[0].tasks[0].notes?.length === 2);
check("add_notes: preserves other data", n1.phases[0].tasks[0].content === "Create claude-scanner");

// Accumulate notes
const n2 = applyOp(n1.phases, { op: "add_notes", task: "Create claude-scanner", notes: ["third note"] });
check("add_notes: accumulate", n2.phases[0].tasks[0].notes?.length === 3);

// Missing task
const n3 = applyOp(makePhases(), { op: "add_notes", task: "nonexistent", notes: ["nope"] });
check("add_notes: missing task error", n3.errors.length > 0);

// Empty notes
const n4 = applyOp(makePhases(), { op: "add_notes", task: "Create claude-scanner" });
check("add_notes: missing notes error", n4.errors.length > 0);

const n5 = applyOp(makePhases(), { op: "add_notes", task: "Create claude-scanner", notes: [] });
check("add_notes: empty notes error", n5.errors.length > 0);

// Missing task field
const n6 = applyOp(makePhases(), { op: "add_notes", notes: ["x"] });
check("add_notes: missing task field error", n6.errors.length > 0);

// ── 18. update_details ─────────────────────────────────────────

const p20 = makePhases();
const d1 = applyOp(p20, { op: "update_details", task: "Create claude-scanner", details: "Scan ~/.claude/projects for .jsonl files" });
check("update_details: success", d1.errors.length === 0 && d1.phases[0].tasks[0].details === "Scan ~/.claude/projects for .jsonl files");

// Missing task
const d2 = applyOp(makePhases(), { op: "update_details", task: "nonexistent", details: "x" });
check("update_details: missing task error", d2.errors.length > 0);

// Missing details
const d3 = applyOp(makePhases(), { op: "update_details", task: "Create claude-scanner" });
check("update_details: missing details error", d3.errors.length > 0);

// ── 19. todoMatchesAnyDescription ───────────────────────────────

const {
  todoMatchesAnyDescription,
} = await import("../packages/core/todo/types.ts");

check("match: exact match", todoMatchesAnyDescription("Create scanner", ["Create scanner", "Build UI"]));
check("match: contained in desc", todoMatchesAnyDescription("scanner module", ["Build the scanner module for claude"]));
check("no match: different", !todoMatchesAnyDescription("Create scanner", ["Build picker UI"]));
check("no match: empty descriptions", !todoMatchesAnyDescription("Create scanner", []));
check("no match: short substring filtered", !todoMatchesAnyDescription("test", ["testing something"]));
check("match: desc contained in content", todoMatchesAnyDescription("Create scanner module for AI", ["scanner module"]));
check("match: CJK contained", todoMatchesAnyDescription("构建扫描器模块", ["快速构建扫描器模块的方法"]));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
