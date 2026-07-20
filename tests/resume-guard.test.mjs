// swarm resume guard unit tests (pure, no pi runtime needed).
const { validateSwarmResume } = await import("../packages/core/swarm/resume-guard.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const saved = { items: ["a", "b", "c", "d"], completedItems: ["a", "b"] };

// 1. No saved swarm → refuse
{
  const v = validateSwarmResume(null, null);
  check("no saved → not ok", !v.ok && /No saved/.test(v.reason ?? ""), v.reason);
}

// 2. In-flight swarm blocks the resume (idle validation)
{
  const v = validateSwarmResume(saved, { status: "running" });
  check("in-flight → blocked", !v.ok && /already running/.test(v.reason ?? ""), v.reason);
}

// 3. Non-running in-flight state does not block
{
  const v = validateSwarmResume(saved, { status: "done" });
  check("settled in-flight state → ok", v.ok && v.pendingItems.length === 2);
}

// 4. Happy path: remaining = items minus completed
{
  const v = validateSwarmResume(saved, null);
  check("pending computed", v.ok && v.pendingItems.join(",") === "c,d", v.pendingItems.join(","));
}

// 5. All completed → nothing to resume
{
  const v = validateSwarmResume({ items: ["a"], completedItems: ["a"] }, null);
  check("all done → not ok", !v.ok && /Nothing to resume/.test(v.reason ?? ""), v.reason);
}

// 6. Empty saved items → nothing to resume
{
  const v = validateSwarmResume({ items: [], completedItems: [] }, null);
  check("empty items → not ok", !v.ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
