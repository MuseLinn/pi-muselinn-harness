// Hooks engine unit tests (pure, no pi runtime, no model quota).
// TS is transformed by pi's bundled jiti (extensionless relative imports
// cannot be loaded by node --experimental-strip-types). jiti.import/jiti()
// exhibit stale-namespace behavior for cross-module `export let` state
// (jiti 2.7.0), so evaluation uses a small local CJS loader around
// jiti.transform with a single shared module cache.
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
  const base = path.resolve(path.dirname(parentFile), spec);
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

const EXT = "C:/Users/unive/.pi/agent/extensions/pi-muselinn-harness";
const { parseHooksToml, getHookRules, resetHookConfigCache } = loadTs(`${EXT}/hooks/config.ts`);
const { runHookCommand, interpretResult } = loadTs(`${EXT}/hooks/executor.ts`);
const { hookEngine } = loadTs(`${EXT}/hooks/index.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ── Isolation: point every config lookup root at empty temp dirs so the real
//    machine's config.toml files can never leak into the tests. ──
const cleanRoot = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-clean-"));
process.env.KIMI_CODE_HOME = cleanRoot;
process.env.HOME = cleanRoot;

const writeConfig = (dir, content) => {
  const cfgDir = path.join(dir, ".kimi-code");
  fs.mkdirSync(cfgDir, { recursive: true });
  const p = path.join(cfgDir, "config.toml");
  fs.writeFileSync(p, content, "utf-8");
  return p;
};
// mtime granularity can be coarse; ensure a visible mtime bump on rewrite.
const bump = (p) => {
  const t = new Date(Date.now() + 2000);
  fs.utimesSync(p, t, t);
};

// ============================================================
// 1. TOML mini parser
// ============================================================

const valid = parseHooksToml(`
# a comment
[[hooks]]
event = "PreToolUse"        # trailing comment
matcher = "bash|write"
command = "echo \\"hi\\" # not a comment"
timeout = 45

[[hooks]]
event = "Stop"
command = "true"
`);
check("toml: valid entries parsed", valid.length === 2, `got ${valid.length}`);
check("toml: fields", valid[0]?.event === "PreToolUse" && valid[0]?.command === 'echo "hi" # not a comment');
check("toml: matcher compiled", valid[0]?.matcher instanceof RegExp && valid[0].matcher.test("bash") && !valid[0].matcher.test("read"));
check("toml: explicit timeout", valid[0]?.timeout === 45);
check("toml: default timeout 30", valid[1]?.timeout === 30 && valid[1]?.matcher === undefined);

check("toml: missing event skipped", parseHooksToml(`[[hooks]]\ncommand = "x"`).length === 0);
check("toml: missing command skipped", parseHooksToml(`[[hooks]]\nevent = "Stop"`).length === 0);
check("toml: extra field skipped", parseHooksToml(`[[hooks]]\nevent = "Stop"\ncommand = "x"\nfoo = "bar"`).length === 0);
check("toml: duplicate field skipped", parseHooksToml(`[[hooks]]\nevent = "Stop"\nevent = "PreToolUse"\ncommand = "x"`).length === 0);
check("toml: bad timeout skipped", parseHooksToml(`[[hooks]]\nevent = "Stop"\ncommand = "x"\ntimeout = "abc"`).length === 0);
check("toml: timeout out of range skipped", parseHooksToml(`[[hooks]]\nevent = "Stop"\ncommand = "x"\ntimeout = 0`).length === 0);
check("toml: timeout >600 skipped", parseHooksToml(`[[hooks]]\nevent = "Stop"\ncommand = "x"\ntimeout = 601`).length === 0);
check("toml: invalid regex skipped", parseHooksToml(`[[hooks]]\nevent = "Stop"\nmatcher = "(["\ncommand = "x"`).length === 0);
check("toml: garbage line poisons entry", parseHooksToml(`[[hooks]]\nevent = "Stop"\ncommand = "x"\nthis is not toml`).length === 0);
check("toml: other tables ignored", parseHooksToml(`[core]\nfoo = "bar"\n[[hooks]]\nevent = "Stop"\ncommand = "x"`).length === 1);
check("toml: unterminated string skipped", parseHooksToml(`[[hooks]]\nevent = "Stop\ncommand = "x"`).length === 0);
check("toml: empty content", parseHooksToml("").length === 0);
check("toml: escape \\n in value", parseHooksToml(`[[hooks]]\nevent = "Stop"\ncommand = "a\\nb"`)[0]?.command === "a\nb");

// TOML literal strings ('...') — real-world hook configs use these for
// Windows paths (backslashes stay raw, inner double quotes are fine).
const lit = parseHooksToml(`[[hooks]]\nevent = "Stop"\nmatcher = ""\ncommand = '"C:\\Program Files\\nodejs\\node.exe" "C:/hooks/kimi-hook.js"'`);
check("toml: literal string command", lit.length === 1 && lit[0]?.command === '"C:\\Program Files\\nodejs\\node.exe" "C:/hooks/kimi-hook.js"', JSON.stringify(lit[0]?.command));
check("toml: empty matcher → undefined", lit[0]?.matcher === undefined);
check("toml: literal with # inside", parseHooksToml(`[[hooks]]\nevent = "Stop"\ncommand = 'echo # not comment'`)[0]?.command === "echo # not comment");

// ============================================================
// 2. Config layering + mtime cache
// ============================================================

const projDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-proj-"));
const nestedDir = path.join(projDir, "sub", "deeper");
fs.mkdirSync(nestedDir, { recursive: true });
writeConfig(projDir, `[[hooks]]\nevent = "Stop"\ncommand = "project-hook"`);

// Global layer via KIMI_CODE_HOME (file sits directly in KIMI_CODE_HOME).
fs.writeFileSync(path.join(cleanRoot, "config.toml"), `[[hooks]]\nevent = "Stop"\ncommand = "global-hook"`, "utf-8");
resetHookConfigCache();

// NOTE: project-layer lookups use the explicit projectConfig override —
// every temp dir on this machine sits under C:\Users\unive, whose real
// .kimi-code/config.toml (16 hooks) would otherwise be picked up by the walk.
const projCfgPath = path.join(projDir, ".kimi-code", "config.toml");

const layered = getHookRules(nestedDir, { projectConfig: projCfgPath });
check("layer: project+global merged", layered.length === 2, `got ${layered.length}`);
check("layer: project first", layered[0]?.command === "project-hook" && layered[1]?.command === "global-hook");

// mtime cache: rewrite project config, bump mtime, rules must refresh.
fs.writeFileSync(projCfgPath, `[[hooks]]\nevent = "Stop"\ncommand = "project-hook-v2"`, "utf-8");
bump(projCfgPath);
const refreshed = getHookRules(nestedDir, { projectConfig: projCfgPath });
check("layer: mtime refresh", refreshed[0]?.command === "project-hook-v2", `got ${refreshed[0]?.command}`);

// No config anywhere → no rules (early-exit gate).
const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-empty-"));
delete process.env.KIMI_CODE_HOME;
process.env.KIMI_CODE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-clean2-"));
resetHookConfigCache();
check("layer: empty when no config", getHookRules(emptyDir, { projectConfig: null }).length === 0);

// KIMI_CODE_HOOKS_CONFIG single-file override: skips project walk + global.
const overrideFile = path.join(cleanRoot, "override.toml");
fs.writeFileSync(overrideFile, `[[hooks]]\nevent = "Stop"\ncommand = "override-hook"`, "utf-8");
process.env.KIMI_CODE_HOOKS_CONFIG = overrideFile;
resetHookConfigCache();
const ov = getHookRules(emptyDir);
check("layer: env override is the only source", ov.length === 1 && ov[0]?.command === "override-hook", JSON.stringify(ov));
delete process.env.KIMI_CODE_HOOKS_CONFIG;
resetHookConfigCache();

// ============================================================
// 3. Executor: exit-code semantics (node -e scripts as hooks)
// ============================================================

const cwd = emptyDir;

let r = await runHookCommand(`node -e "process.exit(0)"`, "{}", 10, cwd);
check("exec: exit 0 captured", r.code === 0 && !r.timedOut, JSON.stringify(r));
check("exec: exit 0 allows", interpretResult(r).blocked === false);

r = await runHookCommand(`node -e "process.stdout.write('extra context')"`, "{}", 10, cwd);
check("exec: exit 0 stdout → context output", interpretResult(r).output === "extra context" && !interpretResult(r).blocked);

r = await runHookCommand(`node -e "console.error('do not do that');process.exit(2)"`, "{}", 10, cwd);
check("exec: exit 2 captured", r.code === 2);
const v2 = interpretResult(r);
check("exec: exit 2 blocks with stderr reason", v2.blocked === true && v2.reason === "do not do that", JSON.stringify(v2));

r = await runHookCommand(`node -e "process.exit(1)"`, "{}", 10, cwd);
check("exec: exit 1 fail-open", r.code === 1 && interpretResult(r).blocked === false);

r = await runHookCommand(`node -e "setTimeout(()=>{},30000)"`, "{}", 1, cwd);
check("exec: timeout captured", r.timedOut === true, JSON.stringify({ code: r.code, timedOut: r.timedOut }));
check("exec: timeout fail-open", interpretResult(r).blocked === false);

// stdout JSON permissionDecision deny
r = await runHookCommand(
  `node -e "console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'deny',permissionDecisionReason:'policy says no'}}))"`,
  "{}", 10, cwd);
const vJson = interpretResult(r);
check("exec: stdout JSON deny blocks", vJson.blocked === true && vJson.reason === "policy says no", JSON.stringify(vJson));

// stdout JSON without deny → allow, no context text
r = await runHookCommand(
  `node -e "console.log(JSON.stringify({hookSpecificOutput:{permissionDecision:'allow'}}))"`,
  "{}", 10, cwd);
const vAllow = interpretResult(r);
check("exec: stdout JSON allow passes clean", vAllow.blocked === false && vAllow.output === undefined);

// stdin receives the payload JSON
r = await runHookCommand(
  `node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{process.stdout.write(JSON.parse(d).marker)})"`,
  `{"marker":"stdin-ok"}`, 10, cwd);
check("exec: stdin payload delivered", r.stdout.trim() === "stdin-ok", r.stdout);

// ============================================================
// 4. Engine: matcher filtering, dedupe, block aggregation
// ============================================================

const engineDir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-test-engine-"));
writeConfig(engineDir, `
[[hooks]]
event = "PreToolUse"
matcher = "^bash$"
command = "node -e \\"console.error('blocked by test');process.exit(2)\\""

[[hooks]]
event = "PreToolUse"
matcher = "^bash$"
command = "node -e \\"console.error('blocked by test');process.exit(2)\\""

[[hooks]]
event = "PreToolUse"
command = "node -e \\"process.exit(0)\\""
`);
resetHookConfigCache();
const engineCfg = path.join(engineDir, ".kimi-code", "config.toml");

let agg = await hookEngine.fire("PreToolUse", { tool_name: "bash" }, { blockable: true, matcherText: "bash", cwd: engineDir, projectConfig: engineCfg });
check("engine: blockable fire blocks", agg.blocked === true);
check("engine: reason collected once (dedupe)", agg.reasons.length === 1 && agg.reasons[0] === "blocked by test", JSON.stringify(agg.reasons));

agg = await hookEngine.fire("PreToolUse", { tool_name: "read" }, { blockable: true, matcherText: "read", cwd: engineDir, projectConfig: engineCfg });
check("engine: matcher filters out non-matching rules", agg.blocked === false && agg.reasons.length === 0);

agg = await hookEngine.fire("NonExistentEvent", {}, { blockable: true, cwd: engineDir, projectConfig: engineCfg });
check("engine: no rules → fast empty aggregate", agg.blocked === false && agg.outputs.length === 0);

// Observational fire returns immediately with empty aggregate.
agg = await hookEngine.fire("PostToolUse", { tool_name: "bash" }, { cwd: engineDir, projectConfig: engineCfg });
check("engine: observational fire is empty aggregate", agg.blocked === false && agg.reasons.length === 0);

// Empty config dir → no spawn, instant return.
const t0 = Date.now();
agg = await hookEngine.fire("PreToolUse", {}, { blockable: true, matcherText: "bash", cwd: emptyDir, projectConfig: null });
check("engine: empty config early-exits", agg.blocked === false && Date.now() - t0 < 500);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
