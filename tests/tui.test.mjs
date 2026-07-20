// TUI state visualization unit tests (pure, no pi runtime, no model quota).
// Covers: command argument completions (prefix filter / empty fallback /
// multi-token budget units), task-list overflow collapse, and the pure
// key routers. Uses the same jiti.transform CJS loader as
// tests/permission.test.mjs.
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
const completions = loadTs(`${EXT}/packages/core/completions.ts`);
const utils = loadTs(`${EXT}/swarm/task-list-utils.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ══════════════════════════════════════════════════════════════
// 1. filterCompletions — prefix filter + empty-result fallback
// ══════════════════════════════════════════════════════════════
const ITEMS = [
  { value: "on", label: "on" },
  { value: "off", label: "off" },
  { value: "status", label: "status" },
];

check("filter: empty prefix returns full list",
  completions.filterCompletions(ITEMS, "").length === 3);
check("filter: prefix narrows to matches",
  completions.filterCompletions(ITEMS, "o").length === 2);
check("filter: exact single match",
  completions.filterCompletions(ITEMS, "st").length === 1
  && completions.filterCompletions(ITEMS, "st")[0].value === "status");
check("filter: no-match prefix falls back to full list",
  completions.filterCompletions(ITEMS, "zzz").length === 3);
check("filter: case-insensitive prefix",
  completions.filterCompletions(ITEMS, "OF").length === 1
  && completions.filterCompletions(ITEMS, "OF")[0].value === "off");

// ══════════════════════════════════════════════════════════════
// 2. /goal completions — subcommands + budget units
// ══════════════════════════════════════════════════════════════
const goalAll = completions.goalArgumentCompletions("");
const goalValues = goalAll.map((i) => i.value);
const expectedSubs = ["pause", "resume", "cancel", "replace", "next", "status",
  "queue", "add", "prioritize", "drop", "skip", "budget"];
check("goal: all 12 subcommands present",
  expectedSubs.every((s) => goalValues.includes(s)),
  `got: ${goalValues.join(",")}`);

check("goal: prefix 'p' → pause + prioritize",
  (() => {
    const v = completions.goalArgumentCompletions("p").map((i) => i.value);
    return v.includes("pause") && v.includes("prioritize") && !v.includes("resume");
  })());
check("goal: no-match prefix falls back to full list",
  completions.goalArgumentCompletions("zzz").length === goalAll.length);

// budget: typing the number → no completion
check("goal: 'budget' + space → null (number expected)",
  completions.goalArgumentCompletions("budget ") === null);
check("goal: 'budget 10' (typing number) → null",
  completions.goalArgumentCompletions("budget 10") === null);

// budget: after number + space → all units, values carry full argument text
const budgetUnits = completions.goalArgumentCompletions("budget 10 ");
check("goal: 'budget 10 ' → 6 unit completions",
  budgetUnits !== null && budgetUnits.length === 6);
check("goal: unit values are full argument strings",
  budgetUnits !== null && budgetUnits.every((i) => i.value.startsWith("budget 10 ")));
check("goal: unit set is turns/tokens/ms/s/minutes/hours",
  budgetUnits !== null && ["turns", "tokens", "ms", "s", "minutes", "hours"]
    .every((u) => budgetUnits.some((i) => i.value === `budget 10 ${u}`)));

// budget: unit prefix filter
const budgetT = completions.goalArgumentCompletions("budget 10 t");
check("goal: 'budget 10 t' → turns + tokens",
  budgetT !== null && budgetT.length === 2
  && budgetT.some((i) => i.value === "budget 10 turns")
  && budgetT.some((i) => i.value === "budget 10 tokens"));
check("goal: 'budget 10 h' → hours only",
  (() => {
    const r = completions.goalArgumentCompletions("budget 5 h");
    return r !== null && r.length === 1 && r[0].value === "budget 5 hours";
  })());
check("goal: unit no-match falls back to all units",
  completions.goalArgumentCompletions("budget 10 zzz").length === 6);
check("goal: completed unit + space → null",
  completions.goalArgumentCompletions("budget 10 turns ") === null);

// ══════════════════════════════════════════════════════════════
// 3. /swarm, /plan, /mode completions
// ══════════════════════════════════════════════════════════════
check("swarm: on/off/status present",
  (() => {
    const v = completions.swarmArgumentCompletions("").map((i) => i.value);
    return v.includes("on") && v.includes("off") && v.includes("status");
  })());
check("swarm: prefix 's' → status only",
  (() => {
    const v = completions.swarmArgumentCompletions("s").map((i) => i.value);
    return v.length === 1 && v[0] === "status";
  })());
check("swarm: no-match falls back to full list",
  completions.swarmArgumentCompletions("zzz").length === 3);

check("plan: on/off/clear present",
  (() => {
    const v = completions.planArgumentCompletions("").map((i) => i.value);
    return v.includes("on") && v.includes("off") && v.includes("clear");
  })());
check("plan: prefix 'c' → clear only",
  (() => {
    const v = completions.planArgumentCompletions("c").map((i) => i.value);
    return v.length === 1 && v[0] === "clear";
  })());

check("mode: auto/yolo/manual (+status) present",
  (() => {
    const v = completions.modeArgumentCompletions("").map((i) => i.value);
    return v.includes("auto") && v.includes("yolo") && v.includes("manual");
  })());
check("mode: prefix 'y' → yolo only",
  (() => {
    const v = completions.modeArgumentCompletions("y").map((i) => i.value);
    return v.length === 1 && v[0] === "yolo";
  })());
check("mode: no-match falls back to full list",
  completions.modeArgumentCompletions("zzz").length === 4);

// ══════════════════════════════════════════════════════════════
// 4. collapseTaskList — overflow collapse
// ══════════════════════════════════════════════════════════════
const T = (id, status) => ({ id, status });

check("collapse: fits → all visible, no summary",
  (() => {
    const r = utils.collapseTaskList([T("1", "done"), T("2", "running")], 5);
    return r.visible.length === 2 && r.hiddenTotal === 0
      && utils.formatCollapseSummary(r.hidden) === null;
  })());

check("collapse: exact fit boundary → no summary",
  (() => {
    const tasks = [T("1", "done"), T("2", "done"), T("3", "running")];
    const r = utils.collapseTaskList(tasks, 3);
    return r.visible.length === 3 && r.hiddenTotal === 0;
  })());

check("collapse: overflow drops done first, keeps running",
  (() => {
    // 4 done + 1 running, window 2 → budget 1 → only running survives
    const tasks = [T("d1", "done"), T("d2", "done"), T("r1", "running"), T("d3", "done"), T("d4", "done")];
    const r = utils.collapseTaskList(tasks, 2);
    return r.visible.length === 1 && r.visible[0].id === "r1"
      && r.hiddenTotal === 4 && r.hidden.done === 4;
  })());

check("collapse: summary format '+N more (x done, y running)'",
  (() => {
    const tasks = [T("d1", "done"), T("d2", "done"), T("r1", "running"), T("r2", "running"), T("p1", "pending")];
    const r = utils.collapseTaskList(tasks, 3); // budget 2 → keep both running
    const s = utils.formatCollapseSummary(r.hidden);
    return r.visible.length === 2 && s === "+3 more (2 done, 1 pending)";
  })());

check("collapse: selected (keepIndex) task is force-kept",
  (() => {
    const tasks = [T("r1", "running"), T("r2", "running"), T("d1", "done"), T("d2", "done")];
    const r = utils.collapseTaskList(tasks, 3, 2); // budget 2, keep the done task selected
    const ids = r.visible.map((t) => t.id);
    return ids.includes("d1") && r.visible.length === 2 && r.hiddenTotal === 2;
  })());

check("collapse: keepIndex alone exceeds budget → only selection visible",
  (() => {
    const tasks = [T("r1", "running"), T("r2", "running"), T("d1", "done")];
    const r = utils.collapseTaskList(tasks, 2, 2); // budget 1 → only selected survives
    return r.visible.length === 1 && r.visible[0].id === "d1" && r.hiddenTotal === 2;
  })());

check("collapse: pending kept before done, display order preserved",
  (() => {
    const tasks = [T("d1", "done"), T("p1", "pending"), T("d2", "done"), T("p2", "pending")];
    const r = utils.collapseTaskList(tasks, 3); // budget 2 → both pending, in original order
    const ids = r.visible.map((t) => t.id);
    return ids.length === 2 && ids[0] === "p1" && ids[1] === "p2";
  })());

check("collapse: failed/aborted summarized as interrupted",
  (() => {
    const tasks = [T("r1", "running"), T("f1", "failed"), T("a1", "aborted")];
    const r = utils.collapseTaskList(tasks, 2); // budget 1 → keep running
    const s = utils.formatCollapseSummary(r.hidden);
    return s === "+2 more (2 interrupted)";
  })());

check("collapse: maxRows 0 → everything hidden",
  (() => {
    const r = utils.collapseTaskList([T("1", "running")], 0);
    return r.visible.length === 0 && r.hiddenTotal === 1;
  })());

// ══════════════════════════════════════════════════════════════
// 5. Key routers — main browser + output viewer
// ══════════════════════════════════════════════════════════════
// Injected matcher: a plain lookup table standing in for pi-tui's
// matchesKey + KeybindingsManager.
const KEY_IDS = {
  "up": "\x1b[A", "down": "\x1b[B", "home": "\x1b[H", "end": "\x1b[F",
  "pageUp": "\x1b[5~", "pageDown": "\x1b[6~",
  "escape": "\x1b", "enter": "\r", "tab": "\t",
  "tui.select.up": "\x1b[A", "tui.select.down": "\x1b[B",
  "tui.select.confirm": "\r", "tui.select.cancel": "\x1b",
  "tui.select.pageUp": "\x1b[5~", "tui.select.pageDown": "\x1b[6~",
  "q": "q", "shift+q": "Q", "k": "k", "j": "j",
  "r": "r", "shift+r": "R", "s": "s", "shift+s": "S",
  "o": "o", "shift+o": "O", "y": "y", "shift+y": "Y",
  "u": "u", "d": "d", "g": "g", "shift+g": "G",
};
const match = (data, keyId) => KEY_IDS[keyId] === data;

const route = (data, pending = false) => utils.routeBrowserKey(data, pending, match);

check("keys: ↑ and k → moveUp",
  route("\x1b[A") === "moveUp" && route("k") === "moveUp");
check("keys: ↓ and j → moveDown",
  route("\x1b[B") === "moveDown" && route("j") === "moveDown");
check("keys: Esc/q/Q → cancel",
  route("\x1b") === "cancel" && route("q") === "cancel" && route("Q") === "cancel");
check("keys: Tab → toggleFilter", route("\t") === "toggleFilter");
check("keys: r/R → refresh", route("r") === "refresh" && route("R") === "refresh");
check("keys: s/S → requestStop", route("s") === "requestStop" && route("S") === "requestStop");
check("keys: o/O/Enter → openOutput",
  route("o") === "openOutput" && route("O") === "openOutput" && route("\r") === "openOutput");
check("keys: unrecognized → ignore", route("z") === "ignore");

check("keys: pendingStop y/Y → confirmStop",
  route("y", true) === "confirmStop" && route("Y", true) === "confirmStop");
check("keys: pendingStop any other key → dismissStop",
  route("q", true) === "dismissStop" && route("\x1b", true) === "dismissStop"
  && route("\x1b[A", true) === "dismissStop");

const vroute = (data) => utils.routeViewerKey(data, match);
check("viewer: Esc/q → close", vroute("\x1b") === "close" && vroute("q") === "close");
check("viewer: ↑/k scrollUp, ↓/j scrollDown",
  vroute("\x1b[A") === "scrollUp" && vroute("k") === "scrollUp"
  && vroute("\x1b[B") === "scrollDown" && vroute("j") === "scrollDown");
check("viewer: u/PgUp → pageUp, d/PgDn → pageDown",
  vroute("u") === "pageUp" && vroute("\x1b[5~") === "pageUp"
  && vroute("d") === "pageDown" && vroute("\x1b[6~") === "pageDown");
check("viewer: g/Home → top, G/End → bottom",
  vroute("g") === "top" && vroute("\x1b[H") === "top"
  && vroute("G") === "bottom" && vroute("\x1b[F") === "bottom");
check("viewer: unrecognized → ignore", vroute("z") === "ignore");

// ══════════════════════════════════════════════════════════════
// 6. Status glyphs (rpiv-todo semantics)
// ══════════════════════════════════════════════════════════════
check("glyphs: pending ○ / running ◐ / done ✓ / failed ✗ / aborted ▲",
  utils.statusGlyph("pending") === "○"
  && utils.statusGlyph("running") === "◐"
  && utils.statusGlyph("done") === "✓"
  && utils.statusGlyph("failed") === "✗"
  && utils.statusGlyph("aborted") === "▲");

// ══════════════════════════════════════════════════════════════
// 7. Spinner styles (harness-branded, PI_MUSELINN_SPINNER)
// ══════════════════════════════════════════════════════════════
const helpers = loadTs(`${EXT}/swarm/helpers.ts`);
const { getSpinnerFrames, SPINNER_STYLES, DEFAULT_SPINNER_STYLE } = helpers;

delete process.env.PI_MUSELINN_SPINNER;
check("spinner: default style is braille",
  DEFAULT_SPINNER_STYLE === "braille"
  && getSpinnerFrames() === SPINNER_STYLES.braille);
check("spinner: braille frames are single-width (no emoji)",
  SPINNER_STYLES.braille.every((f) => [...f].length === 1 && f.charCodeAt(0) >= 0x2800 && f.charCodeAt(0) <= 0x28ff));

process.env.PI_MUSELINN_SPINNER = "pulse";
check("spinner: env override selects pulse",
  getSpinnerFrames() === SPINNER_STYLES.pulse);

process.env.PI_MUSELINN_SPINNER = "BOUNCE";
check("spinner: env override is case-insensitive",
  getSpinnerFrames() === SPINNER_STYLES.bounce);

process.env.PI_MUSELINN_SPINNER = "moon";
check("spinner: legacy moon style still available",
  getSpinnerFrames() === SPINNER_STYLES.moon && SPINNER_STYLES.moon.length === 8);

process.env.PI_MUSELINN_SPINNER = "nonexistent";
check("spinner: unknown style falls back to braille",
  getSpinnerFrames() === SPINNER_STYLES.braille);
delete process.env.PI_MUSELINN_SPINNER;

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
