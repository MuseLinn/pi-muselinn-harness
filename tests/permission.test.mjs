// Permission policy chain unit tests (pure, no pi runtime, no model quota).
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

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const { permissionManager } = loadTs(`${EXT}/packages/core/permission/index.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// Isolated cwd (no AGENTS.md / .pi/permissions.json anywhere up its tree).
const cleanCwd = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-clean-"));

// Isolate from the machine's real global instruction files: the policy chain
// now honors $KIMI_CODE_HOME/AGENTS.md and ~/.agents/AGENTS.md
// (Kimi Code instruction-file hierarchy), so point all three lookup roots at
// the empty temp dir unless a test overrides one deliberately.
process.env.KIMI_CODE_HOME = cleanCwd;
process.env.HOME = cleanCwd;
process.env.USERPROFILE = cleanCwd;
// Isolate hooks: the permission ask path fires PermissionRequest/Result hook
// events, and this machine's real ~/.kimi-code/config.toml (16 hooks) would
// otherwise be found by the project-config walk above cleanCwd and spawn
// hook processes with cwd=cleanCwd (locking the temp dir on cleanup).
process.env.KIMI_CODE_HOOKS_CONFIG = path.join(cleanCwd, "no-hooks.toml");

// ctx stub: confirmAnswer controls the simulated user's choice on ask prompts.
function makeCtx(confirmAnswer) {
  return {
    hasUI: true,
    sessionId: "perm-test-session",
    ui: { confirm: async () => confirmAnswer },
  };
}

const evalIn = (tool, input, cwd, approve) =>
  permissionManager.evaluate(tool, input, cwd, makeCtx(approve));

// ── 1. auto 模式: write .env 不能被 auto 短路 ────────────────────────────
permissionManager.resetHistory();
permissionManager.setMode("auto");
{
  const blocked = await evalIn("write", { path: ".env", content: "SECRET=1" }, cleanCwd, false);
  check("auto: write .env is intercepted (not auto-approved)", blocked?.block === true, JSON.stringify(blocked));
  check("auto: write .env interception reason mentions destructive/sensitive",
    /destructive|sensitive|denied/i.test(blocked?.reason ?? ""), blocked?.reason);
}

// ── 2. auto 模式: bash rm -rf 必问 ───────────────────────────────────────
{
  const blocked = await evalIn("bash", { command: "rm -rf /tmp/x" }, cleanCwd, false);
  check("auto: bash 'rm -rf' requires explicit approval", blocked?.block === true, JSON.stringify(blocked));
}

// ── 3. 批准过 bash ls 之后, rm -rf 仍必须问(destructive 不被 sessionApprovals 短路)
permissionManager.resetHistory();
permissionManager.setMode("manual");
{
  const first = await evalIn("bash", { command: "ls -la /tmp/perm-probe" }, cleanCwd, true);
  check("manual: bash ls approved when user confirms", first === undefined, JSON.stringify(first));

  const blocked = await evalIn("bash", { command: "rm -rf /tmp/x" }, cleanCwd, false);
  check("manual: rm -rf still asks after unrelated approval", blocked?.block === true, JSON.stringify(blocked));

  // Even if the user says YES to the destructive ask, it must NOT be cached:
  // the next identical destructive command must ask again.
  const approvedOnce = await evalIn("bash", { command: "rm -rf /tmp/y" }, cleanCwd, true);
  check("manual: destructive approved when user explicitly confirms", approvedOnce === undefined, JSON.stringify(approvedOnce));
  const blockedAgain = await evalIn("bash", { command: "rm -rf /tmp/y" }, cleanCwd, false);
  check("manual: same destructive command is never short-circuited by history", blockedAgain?.block === true, JSON.stringify(blockedAgain));
}

// ── 4. 同指纹的重复操作在 manual 模式第二次被会话批准短路 ─────────────────
permissionManager.resetHistory();
{
  // First call: user confirms -> recorded under input fingerprint.
  await evalIn("bash", { command: "make build" }, cleanCwd, true);
  // Second call: user would DENY, but session history must short-circuit.
  const second = await evalIn("bash", { command: "make build" }, cleanCwd, false);
  check("manual: same-fingerprint repeat approved via session history", second === undefined, JSON.stringify(second));
}

// ── 5. AGENTS.md 含 destructive-ask-always 时 destructive -> deny ─────────
{
  const denyCwd = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-deny-"));
  fs.writeFileSync(path.join(denyCwd, "AGENTS.md"), "# Directives\n\ndestructive-ask-always\n");
  // Even with the user willing to approve, the directive denies outright.
  const blocked = await evalIn("bash", { command: "rm -rf /tmp/z" }, denyCwd, true);
  check("agentsMd destructive-ask-always: destructive denied (not asked)",
    blocked?.block === true && /destructive-ask-always/.test(blocked?.reason ?? ""),
    JSON.stringify(blocked));
  fs.rmSync(denyCwd, { recursive: true, force: true });
}

// ── 5b. 全局 $KIMI_CODE_HOME/AGENTS.md 的 destructive-ask-always 同样生效 ──
{
  const gHome = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-khome-"));
  fs.writeFileSync(path.join(gHome, "AGENTS.md"), "destructive-ask-always\n");
  const prev = process.env.KIMI_CODE_HOME;
  process.env.KIMI_CODE_HOME = gHome;
  try {
    const blocked = await evalIn("bash", { command: "rm -rf /tmp/z" }, cleanCwd, true);
    check("global KIMI_CODE_HOME AGENTS.md: destructive denied",
      blocked?.block === true && /destructive-ask-always/.test(blocked?.reason ?? ""),
      JSON.stringify(blocked));
  } finally {
    process.env.KIMI_CODE_HOME = prev;
    fs.rmSync(gHome, { recursive: true, force: true });
  }
}

// ── 5c. 项目子目录形式 .kimi-code/AGENTS.md 也被识别 ─────────────────────
{
  const projCwd = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-nested-"));
  fs.mkdirSync(path.join(projCwd, ".kimi-code"));
  fs.writeFileSync(path.join(projCwd, ".kimi-code", "AGENTS.md"), "destructive-ask-always\n");
  const blocked = await evalIn("bash", { command: "rm -rf /tmp/z" }, projCwd, true);
  check("project .kimi-code/AGENTS.md: destructive denied",
    blocked?.block === true && /destructive-ask-always/.test(blocked?.reason ?? ""),
    JSON.stringify(blocked));
  fs.rmSync(projCwd, { recursive: true, force: true });
}

// ── 6. 模式切换语义: manual -> ask, yolo -> approve ───────────────────────
permissionManager.resetHistory();
{
  permissionManager.setMode("manual");
  const manualBlocked = await evalIn("bash", { command: "echo mode-probe-6" }, cleanCwd, false);
  check("manual: ordinary bash falls through to ask", manualBlocked?.block === true, JSON.stringify(manualBlocked));

  permissionManager.setMode("yolo");
  const yoloAllowed = await evalIn("bash", { command: "echo mode-probe-6b" }, cleanCwd, false);
  check("yolo: ordinary bash approved without asking", yoloAllowed === undefined, JSON.stringify(yoloAllowed));

  // Safety guards still run before yolo: destructive still asks under yolo.
  const yoloDestructive = await evalIn("bash", { command: "rm -rf /tmp/w" }, cleanCwd, false);
  check("yolo: destructive still intercepted before yolo-approve", yoloDestructive?.block === true, JSON.stringify(yoloDestructive));
}

// Restore a sane default mode for any later in-process consumer.
permissionManager.setMode("manual");
permissionManager.resetHistory();

// ── Subagent gate (evaluateForSubagent): shared-mode broadcast, ask→block ──
const evalSub = (tool, input, cwd) => permissionManager.evaluateForSubagent(tool, input, cwd);

// auto 模式下子代理的普通写操作放行（共享 mode = 广播生效）
permissionManager.setMode("auto");
{
  const r = await evalSub("write", { path: "src/app.ts", content: "x" }, cleanCwd);
  check("subagent(auto): ordinary write allowed", r === undefined, JSON.stringify(r));
}
// 共享模式广播：切到 manual 后同一子代理语境的破坏性命令被拦（ask 降级为 block，不经对话框）
permissionManager.setMode("manual");
{
  const r = await evalSub("bash", { command: "rm -rf /tmp/w" }, cleanCwd);
  check("subagent(manual): destructive ask degrades to block", r?.block === true, JSON.stringify(r));
  check("subagent(manual): block reason names the policy / no-UI",
    /destructive|no UI|approval/i.test(r?.reason ?? ""), r?.reason);
}
// manual 下普通操作仍放行
{
  const r = await evalSub("read", { path: "src/app.ts" }, cleanCwd);
  check("subagent(manual): ordinary read allowed", r === undefined, JSON.stringify(r));
}
// yolo 下敏感文件保护仍然前置（auto/yolo 都不放行 .env）
permissionManager.setMode("yolo");
{
  const r = await evalSub("write", { path: ".env", content: "SECRET=1" }, cleanCwd);
  check("subagent(yolo): sensitive file still blocked", r?.block === true, JSON.stringify(r));
}

permissionManager.setMode("manual");
permissionManager.resetHistory();
fs.rmSync(cleanCwd, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
