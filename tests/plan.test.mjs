// Plan mode round-trip tests (pure, no pi runtime, no model quota).
// TS is transformed by pi's bundled jiti (extensionless relative imports
// cannot be loaded by node --experimental-strip-types). jiti.import/jiti()
// exhibit stale-namespace behavior for cross-module `export let` state
// (jiti 2.7.0), so evaluation uses a small local CJS loader around
// jiti.transform with a single shared module cache — the same setup as
// tests/permission.test.mjs.
//
// Regression guard for the production bug this suite originally danced
// around: enter_plan_mode wrote state via setCurrentPlanMode() in
// plan/types.ts, but exit_plan_mode read a stale `export let` snapshot and
// saw isActive === false. State now lives in `export const` containers
// (planModeState) mutated at property level, so every importer — including
// pi's real jiti loader — observes the same live object. The cross-module
// assertions below (write via types.ts setter, read via plan/index.ts
// manager) pin that contract.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

import { jitiUrl } from "./jiti-path.mjs";
const { createJiti } = await import(jitiUrl());
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
const { planManager } = loadTs(`${EXT}/packages/core/plan/index.ts`);
const planTypes = loadTs(`${EXT}/packages/core/plan/types.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// Isolated session dir so plan files land in a temp tree, not the repo.
const cleanCwd = fs.mkdtempSync(path.join(os.tmpdir(), "plan-test-clean-"));
planManager.setSessionDir(cleanCwd);

// ── Initial state ──
check("initially inactive", planManager.isPlanModeActive() === false);
check("container agrees initially", planTypes.planModeState.isActive === false);

// ── enter → exit round-trip (the production jiti stale-snapshot path) ──
const plan = planManager.enterPlanMode("test round trip");
check("active after enterPlanMode", planManager.isPlanModeActive() === true);
check("container sees enter (cross-module read)", planTypes.planModeState.isActive === true);
check("currentPlan set", planManager.getCurrentPlan()?.id === plan.id);

// Write through the types.ts setter (as the enter_plan_mode tool path does),
// then read through the manager (as exit_plan_mode does) — must not be stale.
planTypes.setPlanActive(false);
check("manager sees types.ts setter write", planManager.isPlanModeActive() === false);
planTypes.setPlanActive(true);
check("manager sees re-activation", planManager.isPlanModeActive() === true);

const exited = planManager.exitPlanMode();
check("exitPlanMode returns plan", exited?.id === plan.id);
check("inactive after exitPlanMode", planManager.isPlanModeActive() === false);
check("container sees exit (cross-module read)", planTypes.planModeState.isActive === false);

// ── Second round-trip: re-enter after exit must also stick ──
const plan2 = planManager.enterPlanMode();
check("re-enter activates", planManager.isPlanModeActive() === true);
check("history accumulates", planTypes.planModeState.history.length >= 2);
planManager.exitPlanMode();
check("second exit deactivates", planManager.isPlanModeActive() === false);

// ── Container identity: import binding is the same object before/after ──
const ref = planTypes.planModeState;
planManager.enterPlanMode();
check("container object identity stable", planTypes.planModeState === ref);
planManager.exitPlanMode();

// ── Bug 1: plan-mode bash gate understands rtk-rewritten commands ──
// pi-rtk-optimizer rewrites `ls "D:/x"` → `rtk ls "D:/x"` (optionally with
// leading env assignments) before this gate vets the command string.
planManager.enterPlanMode("rtk gate tests");
check("rtk-wrapped ls is read-only", planManager.shouldBlockTool("bash", "", "rtk ls /tmp") === false);
check("env + rtk + pipe is read-only", planManager.shouldBlockTool("bash", "", "FOO=bar RTK_X=1 rtk cat file.txt | head -5") === false);
check("rtk global flags stripped", planManager.shouldBlockTool("bash", "", "rtk -q --no-color git status") === false);
check("windows dir is read-only", planManager.shouldBlockTool("bash", "", "dir") === false);
check("rtk rm -rf still blocked", planManager.shouldBlockTool("bash", "", "rtk rm -rf x") === true);
check("unwrapped write still blocked", planManager.shouldBlockTool("bash", "", "rm -rf x") === true);
check("unwrapped read-only still allowed", planManager.shouldBlockTool("bash", "", "ls /tmp | head -5") === false);
check("plan mode blocks task_stop", planManager.shouldBlockTool("task_stop") === true);
check("plan mode blocks cron_create", planManager.shouldBlockTool("cron_create") === true);
check("plan mode blocks cron_delete", planManager.shouldBlockTool("cron_delete") === true);
check("plan mode allows cron_list", planManager.shouldBlockTool("cron_list") === false);
check("plan mode allows agent_file_list", planManager.shouldBlockTool("agent_file_list") === false);
planManager.exitPlanMode();

// ── Bug 2: reenterForRevision preserves the current plan ──
const revPlan = planManager.enterPlanMode("revise test");
const revContent = "# My Plan\n\nDo the thing.\n";
fs.writeFileSync(revPlan.path, revContent, "utf-8"); // model wrote the plan file
planManager.updatePlanContent(revContent);
const revId = revPlan.id;
const revPath = revPlan.path;
planManager.exitPlanMode();
check("inactive after exit before revise", planManager.isPlanModeActive() === false);
const revised = planManager.reenterForRevision();
check("reenterForRevision keeps plan id", revised.id === revId);
check("reenterForRevision keeps plan path", revised.path === revPath);
check("reenterForRevision keeps plan content", revised.content === revContent);
check("reenterForRevision re-activates plan mode", planManager.isPlanModeActive() === true);
check("reenterForRevision sets writing status", revised.status === "writing");
planManager.exitPlanMode();

// ── Bug 4c: validateRestoredState drops stale active plans ──
// stale: active + empty content + missing file → deactivated
planManager.restoreFromData({
  isActive: true,
  currentPlan: { id: "stale-1", content: "", path: path.join(cleanCwd, "plans", "does-not-exist.md"), status: "exploring", createdAt: 1 },
  history: [],
});
check("stale restored state rejected by validation", planManager.validateRestoredState() === false);
check("stale restore clears isActive", planManager.isPlanModeActive() === false);
check("stale restore drops the dead plan", planManager.getCurrentPlan() === null);

// valid: active + empty content + existing file on disk → kept active
const keptPath = path.join(cleanCwd, "plans", "kept.md");
fs.mkdirSync(path.dirname(keptPath), { recursive: true });
fs.writeFileSync(keptPath, "# Kept plan\n", "utf-8");
planManager.restoreFromData({
  isActive: true,
  currentPlan: { id: "kept-1", content: "", path: keptPath, status: "writing", createdAt: 1 },
  history: [],
});
check("valid restored state kept active", planManager.validateRestoredState() === true);
check("valid restore keeps isActive", planManager.isPlanModeActive() === true);
planManager.exitPlanMode();

// ── Bug 4d: exitPlanMode syncs in-memory content from the on-disk plan file ──
const syncPlan = planManager.enterPlanMode("disk sync test");
const diskContent = "# Disk Plan\n\nWritten straight to disk.\n";
fs.writeFileSync(syncPlan.path, diskContent, "utf-8"); // model wrote file; memory not updated
check("memory stale before exit", planManager.getCurrentPlan()?.content === "");
const syncExited = planManager.exitPlanMode();
check("exitPlanMode syncs content from disk", syncExited?.content === diskContent);

// ── Bug: muselinn_plan duplicate entries — persist() must dedup identical state ──
// Production symptom: 5 identical muselinn_plan entries appended within 25s
// (repeat lifecycle calls / post-restore persists with no state change).
{
  const { PlanManager } = loadTs(`${EXT}/packages/core/plan/index.ts`);
  const mgr = new PlanManager();
  mgr.setSessionDir(cleanCwd);
  const appends = [];
  mgr.setPersistence((data) => appends.push(JSON.stringify(data)));

  mgr.enterPlanMode("dedup test");
  mgr.exitPlanMode();   // state change → appended
  mgr.exitPlanMode();   // no state change (already reviewing/inactive) → deduped
  mgr.exitPlanMode();   // ditto
  check("identical repeat persists are skipped", appends.length === 2, `appends=${appends.length}`);

  // A real change after deduping still persists.
  mgr.enterPlanMode("dedup test 2");
  check("real state change still persists", appends.length === 3, `appends=${appends.length}`);

  // Restore seeds the baseline: a no-change persist right after restore
  // must not re-append the state that was just read from the session.
  const mgr2 = new PlanManager();
  mgr2.setSessionDir(cleanCwd);
  const appends2 = [];
  mgr2.setPersistence((data) => appends2.push(JSON.stringify(data)));
  mgr2.restoreFromData({
    isActive: false,
    currentPlan: { id: "rest-1", content: "# Plan\n", path: path.join(cleanCwd, "plans", "gone.md"), status: "reviewing", createdAt: 1 },
    history: [],
  });
  mgr2.exitPlanMode(); // no-op state-wise (path missing → content kept, already reviewing/inactive)
  check("post-restore no-change persist is deduped", appends2.length === 0, `appends=${appends2.length}`);

  // Stale validation DOES change state → persists exactly once.
  mgr2.restoreFromData({
    isActive: true,
    currentPlan: { id: "rest-2", content: "", path: path.join(cleanCwd, "plans", "gone2.md"), status: "exploring", createdAt: 1 },
    history: [],
  });
  mgr2.validateRestoredState();
  check("stale-restore correction persists once", appends2.length === 1, `appends=${appends2.length}`);
}

fs.rmSync(cleanCwd, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
