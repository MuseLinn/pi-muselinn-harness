// stream rules engine unit tests (pure).
const {
  evaluateStreamRules,
  applyStreamRuleInjections,
  parseStreamRulesToml,
  createStreamRuleState,
} = await import("../packages/core/stream-rules/index.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// 1. matcher gates injection
{
  const st = createStreamRuleState();
  const rules = [{ id: "r1", matcher: "todo", inject: "no todos" }];
  check("no match → no injection", evaluateStreamRules(rules, st, "hello world").length === 0);
  check("match → injection", evaluateStreamRules(rules, st, "call todo_list now").join() === "no todos");
}

// 2. matcher-less rule always fires, once respected
{
  const st = createStreamRuleState();
  const rules = [{ id: "r2", inject: "always", once: true }];
  check("first turn fires", evaluateStreamRules(rules, st, "x").length === 1);
  check("once → second turn silent", evaluateStreamRules(rules, st, "x").length === 0);
}

// 3. cooldownTurns
{
  const st = createStreamRuleState();
  const rules = [{ id: "r3", inject: "cd", cooldownTurns: 3 }];
  evaluateStreamRules(rules, st, "x"); // turn 1 fires
  check("inside cooldown silent", evaluateStreamRules(rules, st, "x").length === 0); // turn 2
  check("still cooling", evaluateStreamRules(rules, st, "x").length === 0); // turn 3... turn-last=1, 3-1=2 < 3
  check("cooldown elapsed fires", evaluateStreamRules(rules, st, "x").length === 1); // turn 4, 4-1=3 >= 3
}

// 4. bad regex skipped, empty inject skipped
{
  const st = createStreamRuleState();
  const rules = [
    { id: "bad", matcher: "([", inject: "x" },
    { id: "empty", inject: "  " },
  ];
  check("bad regex + empty inject skipped", evaluateStreamRules(rules, st, "anything").length === 0);
}

// 5. applyStreamRuleInjections
check("no injections → base unchanged", applyStreamRuleInjections("BASE", []) === "BASE");
check("injections appended as block", applyStreamRuleInjections("BASE", ["a", "b"]) === "BASE\n\n## Active stream rules\n- a\n- b");

// 6. TOML parsing
{
  const toml = `
# comment
[[stream_rules]]
id = "no-todos"
matcher = "todo_list"
inject = "Do not create todos for trivial tasks"
once = true
cooldownTurns = 5

[[stream_rules]]
id = 'plain'
inject = 'always on'
unknownKey = "ignored"
`;
  const rules = parseStreamRulesToml(toml);
  check("2 rules parsed", rules.length === 2);
  check("fields", rules[0].id === "no-todos" && rules[0].matcher === "todo_list" && rules[0].once === true && rules[0].cooldownTurns === 5);
  check("single quotes + unknown key", rules[1].id === "plain" && rules[1].inject === "always on" && !("unknownKey" in rules[1]));
  check("incomplete entry dropped", parseStreamRulesToml('[[stream_rules]]\nid = "x"').length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
