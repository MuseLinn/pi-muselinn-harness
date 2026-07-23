// Background task module tests (pure, no pi runtime, no model quota).
// Same jiti-transform mini loader as tests/plan.test.mjs (extensionless / .ts
// relative imports cannot be loaded by node directly). The only non-relative
// import in the chain — @earendil-works/pi-coding-agent — is stubbed: these
// tests never spawn a real session, they pin manager/state behavior.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";

import { jitiUrl } from "./jiti-path.mjs";
const { createJiti } = await import(jitiUrl());
const jiti = createJiti(import.meta.url ?? __filename, { moduleCache: false });
const nativeRequire = createRequire(import.meta.url);
const moduleCache = new Map();

// Stub for the ESM-only pi SDK. createExtensionRuntime presence emulates
// pi >= 0.81 so the resourceLoader includes LoadExtensionsResult.runtime.
const piStub = {
  createAgentSession: async () => { throw new Error("not used in tests"); },
  SessionManager: { inMemory: () => ({}) },
  createExtensionRuntime: () => ({ flagValues: new Map() }),
};

function resolveSpec(spec, parentFile) {
  if (!spec.startsWith(".")) return { native: spec };
  const clean = spec.endsWith(".js") ? spec.slice(0, -3) : spec;
  const base = path.resolve(path.dirname(parentFile), clean);
  for (const c of [base + ".ts", base + ".js", base, base + "/index.ts"]) {
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
    if (spec === "@earendil-works/pi-coding-agent") return piStub;
    const r = resolveSpec(spec, key);
    return r.native ? nativeRequire(spec) : loadTs(r.file);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", code)(
    module.exports, localRequire, module, key, path.dirname(key));
  return module.exports;
}

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const taskState = loadTs(`${EXT}/packages/core/task/state.ts`);
const taskMod = loadTs(`${EXT}/task/index.ts`);
const { backgroundManager, registerBackgroundTools, createSubagentResourceLoader } = taskMod;

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ── Bug 1 root cause: restored entries may lack a usable `prompt` ──
// Older/foreign writers persisted the task text as `description`; restore
// spread `...e` verbatim, so prompt survived as undefined and task_list's
// prompt.slice() threw "Cannot read properties of undefined".
{
  const restored = taskState.computeRestoredTask({
    id: "legacy-1", description: "old style entry", status: "completed",
    startTime: 1, createdAt: 1, turns: 0, usage: { input: 0, output: 0, cost: 0 },
  }, Date.now());
  check("restore maps legacy description → prompt", restored.prompt === "old style entry");

  const restoredMissing = taskState.computeRestoredTask({
    id: "legacy-2", status: "completed",
    startTime: 1, createdAt: 1, turns: 0, usage: { input: 0, output: 0, cost: 0 },
  }, Date.now());
  check("restore defaults missing prompt to ''", restoredMissing.prompt === "");

  const restoredWeird = taskState.computeRestoredTask({
    id: "legacy-3", prompt: 42, status: "completed",
    startTime: 1, createdAt: 1, turns: 0, usage: { input: 0, output: 0, cost: 0 },
  }, Date.now());
  check("restore coerces non-string prompt to ''", restoredWeird.prompt === "");

  const restoredOk = taskState.computeRestoredTask({
    id: "ok-1", prompt: "real prompt", status: "completed",
    startTime: 1, createdAt: 1, turns: 0, usage: { input: 0, output: 0, cost: 0 },
  }, Date.now());
  check("restore keeps a valid prompt", restoredOk.prompt === "real prompt");
}

// ── Bug 1 defense: task_list renders prompt-less restored tasks ──
// Drive the real registered tool with a mock pi. Restore a prompt-less
// entry directly into the manager, then call the full (non-filtered) list —
// the exact call shape that threw isError in production.
{
  const tools = new Map();
  const mockPi = { registerTool: (def) => tools.set(def.name, def) };
  registerBackgroundTools(mockPi);

  backgroundManager.restore([{
    id: "restored-noprompt", status: "completed", // no prompt field at all
    startTime: Date.now() - 1000, createdAt: Date.now() - 1000, endTime: Date.now(),
    turns: 0, usage: { input: 0, output: 0, cost: 0 },
  }]);

  const listAll = await tools.get("task_list").execute("c1", {}, undefined, undefined, {});
  const text = listAll.content[0].text;
  check("task_list (no args) does not throw on prompt-less task", text.includes("restored-noprompt"), text.slice(0, 120));
  check("task_list shows restored status", text.includes("[completed]"));

  const listActive = await tools.get("task_list").execute("c2", { active_only: true }, undefined, undefined, {});
  check("task_list active_only still works", listActive.content[0].text.includes("No running background tasks."));
}

// ── Bug 2: block=true waits for completion and returns the real report ──
{
  const tools = new Map();
  const mockPi = { registerTool: (def) => tools.set(def.name, def) };
  registerBackgroundTools(mockPi);

  backgroundManager.register({
    id: "bg-block-test", prompt: "do a thing", model: "m", subagentType: "explore",
    status: "running", outputLines: [], startTime: Date.now(), createdAt: Date.now(),
    turns: 0, usage: { input: 0, output: 0, cost: 0 },
  });

  const started = Date.now();
  const outputPromise = tools.get("task_output").execute(
    "c3", { task_id: "bg-block-test", block: true, timeout: 5 }, undefined, undefined, {});
  setTimeout(() => backgroundManager.complete("bg-block-test", ["final report line"]), 150);
  const res = await outputPromise;
  const waited = Date.now() - started;
  check("block=true waited for completion", waited >= 120, `waited=${waited}ms`);
  check("block=true returned the real report", res.content[0].text.includes("final report line"));

  // block on an already-finished task returns immediately with the report
  const again = await tools.get("task_output").execute(
    "c4", { task_id: "bg-block-test", block: true, timeout: 5 }, undefined, undefined, {});
  check("block on finished task returns report", again.content[0].text.includes("final report line"));
}

// ── Bug 2: block=true honors the timeout on a still-running task ──
{
  backgroundManager.register({
    id: "bg-timeout-test", prompt: "slow", model: "m", subagentType: "explore",
    status: "running", outputLines: ["partial"], startTime: Date.now(), createdAt: Date.now(),
    turns: 0, usage: { input: 0, output: 0, cost: 0 },
  });
  const tools = new Map();
  registerBackgroundTools({ registerTool: (def) => tools.set(def.name, def) });
  const started = Date.now();
  const res = await tools.get("task_output").execute(
    "c5", { task_id: "bg-timeout-test", block: true, timeout: 1 }, undefined, undefined, {});
  const waited = Date.now() - started;
  check("block=true returns after timeout", waited >= 900 && waited < 5000, `waited=${waited}ms`);
  check("timeout returns partial output", res.content[0].text.includes("partial"));
  backgroundManager.stop("bg-timeout-test", "test cleanup");
}

// ── getOutput surfaces the error for a task that failed with no output ──
{
  backgroundManager.register({
    id: "bg-fail-test", prompt: "will fail", model: "m", subagentType: "explore",
    status: "running", outputLines: [], startTime: Date.now(), createdAt: Date.now(),
    turns: 0, usage: { input: 0, output: 0, cost: 0 },
  });
  backgroundManager.fail("bg-fail-test", "Cannot set properties of undefined (setting 'sendMessage')");
  const out = backgroundManager.getOutput("bg-fail-test");
  check("failed task output surfaces error", out.includes("sendMessage"), out.slice(0, 120));
}

// ── Bug 2 root cause: resourceLoader provides extensions runtime (pi ≥ 0.81) ──
{
  const loader = createSubagentResourceLoader({ cwd: process.cwd() });
  const ext = loader.getExtensions();
  check("getExtensions returns extensions array", Array.isArray(ext.extensions));
  check("getExtensions returns errors array", Array.isArray(ext.errors));
  check("getExtensions includes runtime when SDK provides it", ext.runtime !== undefined && ext.runtime !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
