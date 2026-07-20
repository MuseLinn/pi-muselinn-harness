// todo_list core logic unit tests (pure, no pi runtime needed).
const {
  normalizeTodos,
  summarizeTodos,
  selectVisibleTodos,
  MAX_VISIBLE_TODOS,
} = await import("../packages/core/todo/types.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const T = (id, status, title = `task ${id}`) => ({ id, title, status });

// 1. normalizeTodos
const n1 = normalizeTodos([{ title: "write tests" }, { title: "ship", status: "in_progress" }]);
check("ids auto-assigned", n1[0].id === "t1" && n1[1].id === "t2");
check("status kept", n1[1].status === "in_progress");
check("default status pending", n1[0].status === "pending");
check("bad status → pending", normalizeTodos([{ title: "x", status: "weird" }])[0].status === "pending");
check("dup id disambiguated", (() => { const l = normalizeTodos([{ id: "a", title: "1" }, { id: "a", title: "2" }]); return l[0].id !== l[1].id; })());

let threw = 0;
try { normalizeTodos("nope"); } catch { threw++; }
try { normalizeTodos([{ title: "" }]); } catch { threw++; }
try { normalizeTodos([{ title: "  " }]); } catch { threw++; }
check("3 invalid shapes throw", threw === 3, `threw=${threw}`);

// 2. summarizeTodos
const s = summarizeTodos([T("1", "done"), T("2", "done"), T("3", "in_progress"), T("4", "pending")]);
check("summarize counts", s.done === 2 && s.in_progress === 1 && s.pending === 1);

// 3. selectVisibleTodos — short list passes through
const short = [T("1", "pending"), T("2", "done")];
const v1 = selectVisibleTodos(short);
check("short list: all rows, no hidden", v1.rows.length === 2 && v1.hidden === 0);
check("MAX_VISIBLE is 5", MAX_VISIBLE_TODOS === 5);

// 4. >5: in_progress all visible
const long1 = [
  T("1", "pending"), T("2", "pending"), T("3", "pending"),
  T("4", "in_progress"), T("5", "in_progress"),
  T("6", "pending"), T("7", "pending"),
];
const v2 = selectVisibleTodos(long1);
const v2ids = v2.rows.map((t) => t.id);
check("both in_progress visible", v2ids.includes("4") && v2ids.includes("5"));
check("folded to 5 rows", v2.rows.length === 5);
check("hidden counts pending", v2.hidden === 2 && v2.hiddenCounts.pending === 2);

// 5. >5 with done items: one slot kept for most recent done
const long2 = [
  T("1", "done"), T("2", "done"), T("3", "done"),
  T("4", "pending"), T("5", "pending"), T("6", "pending"), T("7", "pending"),
];
const v3 = selectVisibleTodos(long2);
const v3ids = v3.rows.map((t) => t.id);
check("most recent done kept", v3ids.includes("3") && !v3ids.includes("1"));
check("earliest pending kept", v3ids.includes("4") && v3ids.includes("5"));
check("row order by original index", v3ids.join(",") === ["3", "4", "5", "6", "7"].filter((x) => v3ids.includes(x)).join(","));

// 6. all in_progress > 5: first 5 in_progress
const long3 = Array.from({ length: 7 }, (_, i) => T(`t${i + 1}`, "in_progress"));
const v4 = selectVisibleTodos(long3);
check("5 in_progress shown", v4.rows.length === 5 && v4.rows.every((t) => t.status === "in_progress"));
check("hidden 2 in_progress", v4.hiddenCounts.in_progress === 2);

// 7. no pending candidates: done fills remaining
const long4 = [T("1", "done"), T("2", "done"), T("3", "done"), T("4", "done"), T("5", "done"), T("6", "done")];
const v5 = selectVisibleTodos(long4);
check("all-done folds to 5", v5.rows.length === 5 && v5.hidden === 1);
check("most recent done visible", v5.rows.some((t) => t.id === "6"));

// 8. maxVisible parameter honored
const long5 = Array.from({ length: 8 }, (_, i) => T(`t${i + 1}`, "pending"));
check("maxVisible=3 folds to 3", selectVisibleTodos(long5, 3).rows.length === 3);
check("maxVisible=8 shows all", selectVisibleTodos(long5, 8).rows.length === 8);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
