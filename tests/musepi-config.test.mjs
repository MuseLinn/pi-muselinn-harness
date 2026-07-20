// musepi settings schema unit tests (pure).
const { mergeMusepiSettings, MUSEPI_DEFAULTS, MUSEPI_SETTINGS_DOCS } = await import("../packages/core/config/schema.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// 1. undefined → full defaults
{
  const r = mergeMusepiSettings(undefined);
  check("undefined → defaults", r.todo.maxVisible === 5 && r.goal.badge === true && r.swarm.timeoutMs === 1_800_000);
}

// 2. partial override merges per field
{
  const r = mergeMusepiSettings({ todo: { maxVisible: 8 }, tui: { style: "compact" } });
  check("override applied", r.todo.maxVisible === 8 && r.tui.style === "compact");
  check("others defaulted", r.goal.badge === true && r.tui.modelInBorder === false && r.swarm.maxConcurrency === 5);
}

// 3. mistyped values fall back to defaults
{
  const r = mergeMusepiSettings({ todo: { maxVisible: "eight" }, goal: { badge: "yes" } });
  check("mistyped number → default", r.todo.maxVisible === 5);
  check("mistyped boolean → default", r.goal.badge === true);
}

// 4. unknown fields dropped
{
  const r = mergeMusepiSettings({ todo: { maxVisible: 7, bogus: 1 }, unknownSection: { x: 1 } });
  check("unknown field dropped", !("bogus" in r.todo) && !("unknownSection" in r));
}

// 5. non-object section ignored
{
  const r = mergeMusepiSettings({ swarm: "lots" });
  check("non-object section → defaults", r.swarm.maxConcurrency === 5 && r.swarm.modelTier === "auto");
}

// 6. docs cover every defaults field
{
  const docKeys = new Set(MUSEPI_SETTINGS_DOCS.map((d) => d.key));
  const defaultKeys = Object.entries(MUSEPI_DEFAULTS).flatMap(([sec, fields]) =>
    Object.keys(fields).map((f) => `${sec}.${f}`));
  check("docs cover all defaults", defaultKeys.every((k) => docKeys.has(k)), defaultKeys.filter((k) => !docKeys.has(k)).join(","));
  check("docs defaults match", MUSEPI_SETTINGS_DOCS.every((d) => {
    const [sec, f] = d.key.split(".");
    return MUSEPI_DEFAULTS[sec]?.[f] === d.defaultValue;
  }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
