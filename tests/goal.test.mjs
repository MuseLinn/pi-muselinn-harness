// Goal state machine unit tests (pure, no pi runtime, no model quota).
// Same jiti.transform-based loader as permission.test.mjs — see that file
// for the rationale (jiti 2.7.0 stale-namespace behavior on `export let`).
import * as fs from "node:fs";
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
const { goalManager } = loadTs(`${EXT}/packages/core/goal/index.ts`);
const { registerGoalTools } = loadTs(`${EXT}/packages/core/goal/tools.ts`);

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

// ── 5. restore 单调合并: 同 goalId 的过期 entry 不回退计数器 ─────────────
// (徽标 turns 闪变的修复核心: recordTurn 每次都持久化, 恢复侧取 max,
//  内存新值永远不会被 entry 旧值回拉)
reset();
{
  goalManager.createGoal("merge probe");
  goalManager.recordTurn(100);
  goalManager.recordTurn(100);
  const cur = goalManager.getGoal();
  check("recordTurn accumulates counters", cur?.turnsUsed === 2 && cur?.tokensUsed === 200,
    JSON.stringify({ t: cur?.turnsUsed, tok: cur?.tokensUsed }));

  const stale = { ...cur, turnsUsed: 1, tokensUsed: 50, wallClockMs: 0 };
  goalManager.restoreFromData(stale);
  const after = goalManager.getGoal();
  check("stale entry (same goalId) does not regress counters (max merge)",
    after?.turnsUsed === 2 && after?.tokensUsed === 200,
    JSON.stringify({ t: after?.turnsUsed, tok: after?.tokensUsed }));

  // 不同 goalId(会话切换)允许整体替换
  goalManager.restoreFromData({ ...stale, goalId: "g-other-session", turnsUsed: 0, tokensUsed: 0 });
  check("different goalId replaces wholesale (session switch)",
    goalManager.getGoal()?.goalId === "g-other-session" && goalManager.getGoal()?.turnsUsed === 0);
}

// ── 6. tryRestoreFromEntries: 仅空状态恢复 + complete 墓碑不恢复 ─────────
function goalEntry(data) { return { type: "custom", customType: "muselinn_goal", data }; }
function entryData(over = {}) {
  return {
    goalId: "g-e1", objective: "entry goal", status: "active", lastActor: "user",
    lastActedAt: new Date().toISOString(), turnsUsed: 7, tokensUsed: 70, wallClockMs: 700,
    ...over,
  };
}
reset();
{
  // 6a. 空状态 + 有效 entry → 恢复
  const restored = goalManager.tryRestoreFromEntries([goalEntry(entryData())]);
  check("restore-if-empty restores latest goal entry",
    restored === true && goalManager.getGoal()?.turnsUsed === 7,
    JSON.stringify({ restored, t: goalManager.getGoal()?.turnsUsed }));

  // 6b. 已有内存状态时, 过期 entry 不覆盖(restore-if-empty 守卫)
  goalManager.recordTurn(10); // turns 7 → 8
  goalManager.tryRestoreFromEntries([goalEntry(entryData({ turnsUsed: 3, tokensUsed: 30 }))]);
  check("existing in-memory goal is not overwritten by stale entries",
    goalManager.getGoal()?.turnsUsed === 8, String(goalManager.getGoal()?.turnsUsed));
}
reset();
{
  // 6c. 最新 entry 是 complete 墓碑 → 不恢复, 也不回退到更老的 active entry
  const entries = [
    goalEntry(entryData({ goalId: "g-old", turnsUsed: 5 })),
    goalEntry(entryData({ goalId: "g-old", status: "complete", turnsUsed: 6 })),
  ];
  const r = goalManager.tryRestoreFromEntries(entries);
  check("latest complete entry acts as tombstone (no restore, no fall-through)",
    r === false && goalManager.getGoal() === null, JSON.stringify({ r }));
}

// ── 7. clear() 写墓碑: 清除后 restore 不复活目标 ─────────────────────────
reset();
{
  const appended = [];
  goalManager.setAppendEntry((type, data) => appended.push({ type, data }));
  goalManager.createGoal("tombstone probe");
  goalManager.recordTurn(10);
  goalManager.clear();
  goalManager.setAppendEntry(() => {});
  const tombstones = appended.filter(a => a.type === "muselinn_goal" && a.data?.status === "complete");
  check("clear() appends a complete-status tombstone entry", tombstones.length >= 1,
    JSON.stringify(appended.map(a => a.data?.status)));

  const entries = appended.map(a => goalEntry(a.data));
  const r = goalManager.tryRestoreFromEntries(entries);
  check("cleared goal is not resurrected from entries",
    r === false && goalManager.getGoal() === null, JSON.stringify({ r }));
}

// ── 8. recordTurn 每次都持久化(徽标单调的写侧保证) ───────────────────────
reset();
{
  const appended = [];
  goalManager.setAppendEntry((_type, data) => appended.push(data));
  goalManager.createGoal("persist probe");
  goalManager.recordTurn(10);
  goalManager.recordTurn(10);
  goalManager.setAppendEntry(() => {});
  const turnsSeq = appended.map(d => d.turnsUsed);
  check("recordTurn persists every turn (monotonic entry sequence)",
    JSON.stringify(turnsSeq) === JSON.stringify([0, 1, 2]), JSON.stringify(turnsSeq));
}

// ── 9. update_goal 工具层: criterion 门控 + 文档讲清 verified 约定 ───────
reset();
{
  const tools = new Map();
  registerGoalTools({ registerTool: (def) => tools.set(def.name, def) }, goalManager);
  const updateGoal = tools.get("update_goal");
  check("update_goal tool registered", !!updateGoal);

  const doc = [
    updateGoal.promptSnippet,
    ...(updateGoal.promptGuidelines ?? []),
    updateGoal.parameters?.properties?.status?.description ?? "",
    updateGoal.parameters?.properties?.verified?.description ?? "",
  ].join("\n");
  check("update_goal docs explain verified=true is required with a declared criterion",
    /verified=true/.test(doc) && /criterion/i.test(doc) && /refus/i.test(doc));

  const createGoal = tools.get("create_goal");
  const createDoc = [
    createGoal.promptSnippet,
    ...(createGoal.promptGuidelines ?? []),
    createGoal.parameters?.properties?.completion_criterion?.description ?? "",
  ].join("\n");
  check("create_goal docs warn that declaring a criterion gates completion on verified=true",
    /verified=true/.test(createDoc) && /criterion/i.test(createDoc));

  goalManager.createGoal("tool friction probe", "all tests green");
  const refused = await updateGoal.execute("tc1", { status: "complete" }, null, null, {});
  check("tool-layer complete without verified is refused with guidance",
    /verified=true/.test(refused.content?.[0]?.text ?? ""), refused.content?.[0]?.text);
  check("goal stays active after refused tool completion",
    goalManager.getGoal()?.status === "active", goalManager.getGoal()?.status);

  const ok = await updateGoal.execute("tc2", { status: "complete", verified: true }, null, null, {});
  check("tool-layer complete with verified=true succeeds",
    goalManager.getGoal()?.status === "complete", ok.content?.[0]?.text);
}

reset();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
