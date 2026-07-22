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

fs.rmSync(cleanCwd, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
