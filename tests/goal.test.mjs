// Goal state machine unit tests (pure, no pi runtime, no model quota).
// Same jiti.transform-based loader as permission.test.mjs — see that file
// for the rationale (jiti 2.7.0 stale-namespace behavior on `export let`).
import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";

const { createJiti } = await import(
  "file:///C:/Users/unive/AppData/Roaming/npm/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs"
);
const jiti = createJiti(import.meta.url ?? __filename, { moduleCache: false });
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

function resolveSpec(spec, parentFile) {
  if (!spec.startsWith(".")) return { native: spec };
  const clean = spec.endsWith(".js") ? spec.slice(0, -3) : spec; // TS ESM convention: ./x.js → ./x.ts
  const base = path.resolve(path.dirname(parentFile), clean);
  for (const c of [base + ".ts", base + ".js", base]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return { file: c };
  }
  throw new Error(`Cannot resolve ${spec} from ${parentFile}`);
}

function loadTs(file) {
  const key = path.resolve(file);
  if (moduleCache.has(key)) return moduleCache.get(key).exports;
  const code = jiti.transform({ source: fs.readFileSync(key, "utf8"), filename: key, ts: true });
  const module = { exports: {} };
  moduleCache.set(key, module); // pre-register for circular imports
  const localRequire = (spec) => {
    const r = resolveSpec(spec, key);
    return r.native ? nativeRequire(spec) : loadTs(r.file);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", code)(
    module.exports, localRequire, module, key, path.dirname(key));
  return module.exports;
}

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const { goalManager } = loadTs(`${EXT}/packages/core/goal/index.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

function reset() {
  // clear() drops the current goal AND its block-attempt counter.
  goalManager.clear();
}

// ── 1. active 守卫: 重复 createGoal 抛错, replace=true 覆盖 ───────────────
reset();
{
  const g1 = goalManager.createGoal("objective one");
  check("createGoal returns active goal", g1.status === "active" && goalManager.getGoal()?.goalId === g1.goalId);

  let threw = false;
  try {
    goalManager.createGoal("objective two");
  } catch (e) {
    threw = /active/.test(String(e?.message ?? e));
  }
  check("createGoal with active goal (no replace) throws", threw);

  const g2 = goalManager.createGoal("objective two", undefined, undefined, "user", true);
  check("createGoal with replace=true overwrites",
    g2.objective === "objective two" && goalManager.getGoal()?.goalId === g2.goalId && g2.goalId !== g1.goalId);
}

// ── 2. block 三次阈值: 同一 reason 前 2 次不变, 第 3 次 blocked ──────────
reset();
{
  goalManager.createGoal("block threshold probe");
  const r1 = goalManager.block("network down");
  check("block attempt 1/3 keeps status", r1?.status === "active", r1?.status);
  const r2 = goalManager.block("network down");
  check("block attempt 2/3 keeps status", r2?.status === "active", r2?.status);
  const r3 = goalManager.block("network down");
  check("block attempt 3/3 enters blocked", r3?.status === "blocked", r3?.status);
  check("blocked goal carries terminalReason", goalManager.getGoal()?.terminalReason === "network down",
    goalManager.getGoal()?.terminalReason);

  // A different reason starts a fresh 3-round window.
  goalManager.resume();
  const d1 = goalManager.block("different reason");
  check("new reason after resume starts fresh window", d1?.status === "active", d1?.status);
}

// ── 3. completionCriterion 门控: 未验证拒绝, verified=true 成功 ───────────
reset();
{
  goalManager.createGoal("criterion probe", "all tests green");
  const refused = goalManager.complete("user", "done?", false);
  check("complete without verification refused (returns null)", refused === null, JSON.stringify(refused));
  check("goal untouched after refused completion", goalManager.getGoal()?.status === "active",
    goalManager.getGoal()?.status);

  const ok = goalManager.complete("user", "all green", true);
  check("complete with verified=true succeeds", ok?.status === "complete", ok?.status);
  check("completionSummary preserved", goalManager.getGoal()?.completionSummary === "all green",
    goalManager.getGoal()?.completionSummary);
}

// ── 3b. 无 criterion 的目标可自由 complete ────────────────────────────────
reset();
{
  goalManager.createGoal("no criterion probe");
  const ok = goalManager.complete("user");
  check("complete without criterion succeeds without verified flag", ok?.status === "complete", ok?.status);
}

// ── 4. editGoal 不静默复活状态 ────────────────────────────────────────────
reset();
{
  goalManager.createGoal("edit probe");
  goalManager.pause();
  check("pause works", goalManager.getGoal()?.status === "paused", goalManager.getGoal()?.status);

  const edited = goalManager.editGoal("edited objective", undefined, "user");
  check("editGoal updates objective", edited?.objective === "edited objective", edited?.objective);
  check("editGoal preserves paused status (no silent revive)",
    goalManager.getGoal()?.status === "paused", goalManager.getGoal()?.status);

  // Explicit status override still works when requested.
  goalManager.editGoal("edited objective", undefined, "user", "active");
  check("editGoal honors explicit status override", goalManager.getGoal()?.status === "active",
    goalManager.getGoal()?.status);
}

reset();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
