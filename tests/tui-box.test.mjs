// TUI chrome unit tests (pure, no pi runtime, no model quota).
// Covers: box drawing (wrapWithSideBorders / composeTopBorder /
// truncateVisible), config load/save/merge, render timing probe,
// /tui arg parsing + completions, and style switch planning.
// Uses the same jiti.transform CJS loader as tests/tui.test.mjs.
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
const box = loadTs(`${EXT}/tui/box.ts`);
const config = loadTs(`${EXT}/tui/config.ts`);
const timing = loadTs(`${EXT}/tui/timing.ts`);
const parse = loadTs(`${EXT}/tui/parse.ts`);
const switchMod = loadTs(`${EXT}/tui/switch.ts`);
const completions = loadTs(`${EXT}/packages/core/completions.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const nopaint = (s) => s;
const paint = (s) => `<b>${s}</b>`;
const vw = (s) => box.stripSgr(s).replace(/<\/?b>/g, "").length;

// ══════════════════════════════════════════════════════════════
// 1. stripSgr
// ══════════════════════════════════════════════════════════════
check("stripSgr: removes color sequences",
  box.stripSgr("\x1b[31mred\x1b[0m plain") === "red plain");
check("stripSgr: plain string untouched",
  box.stripSgr("abc ─") === "abc ─");

// ══════════════════════════════════════════════════════════════
// 2. wrapWithSideBorders — corners, side bars, label, topBorder
// ══════════════════════════════════════════════════════════════
const W = 12;
const dashRow = "─".repeat(W);
const contentRow = " hello      ".slice(0, W); // starts+ends with space
const wrapped = box.wrapWithSideBorders([dashRow, contentRow, dashRow], nopaint, {});
check("wrap: top corners ╭╮", wrapped[0] === "╭" + "─".repeat(W - 2) + "╮", wrapped[0]);
check("wrap: bottom corners ╰╯", wrapped[2] === "╰" + "─".repeat(W - 2) + "╯", wrapped[2]);
check("wrap: side bars on space columns", wrapped[1] === "│hello     │", wrapped[1]);

// label overlay on a plain dash run
const labeled = box.wrapWithSideBorders([dashRow, dashRow], nopaint, { label: " ! shell " });
check("wrap: label overlaid on top border",
  labeled[0].startsWith("╭ ! shell ") && labeled[0].endsWith("╮"), labeled[0]);
check("wrap: label preserves width", vw(labeled[0]) === W, labeled[0]);

// scroll indicator row must NOT get the label, but still gets corners
const scrollRow = "─── ↑ 3 more " + "─".repeat(Math.max(0, W - 13));
const scrolled = box.wrapWithSideBorders([scrollRow, dashRow], nopaint, { label: " X " });
check("wrap: scroll indicator row cornered without label",
  scrolled[0].startsWith("╰") === false && scrolled[0].includes("↑ 3 more") && !scrolled[0].includes(" X "),
  scrolled[0]);

// topBorder option replaces the first dash row outright
const custom = "╭ custom ─╮";
const withTop = box.wrapWithSideBorders([dashRow, contentRow, dashRow], nopaint, { topBorder: custom });
check("wrap: topBorder replaces first dash row", withTop[0] === custom, withTop[0]);
check("wrap: second dash row still bottom corners",
  withTop[2] === "╰" + "─".repeat(W - 2) + "╯", withTop[2]);

// connectedAbove → ├┤ on the top row
const conn = box.wrapWithSideBorders([dashRow, dashRow], nopaint, { connectedAbove: true });
check("wrap: connectedAbove uses ├┤", conn[0] === "├" + "─".repeat(W - 2) + "┤", conn[0]);

// cursor-overflow protection: last char not a literal space → kept
const cursorRow = " hi\x1b[7m \x1b[0m"; // ends with SGR-tagged inverse cursor
const cursorWrapped = box.wrapWithSideBorders([dashRow, cursorRow, dashRow], nopaint, {});
check("wrap: SGR-tagged trailing cursor not overlaid",
  cursorWrapped[1].endsWith("\x1b[7m \x1b[0m"), JSON.stringify(cursorWrapped[1]));

// degenerate rows
check("wrap: empty line passthrough",
  box.wrapWithSideBorders([""], nopaint, {})[0] === "");
check("wrap: single-char dash row cornered",
  box.wrapWithSideBorders(["─"], nopaint, {})[0] === "╭");

// ══════════════════════════════════════════════════════════════
// 3. composeTopBorder — slots, fill, truncation
// ══════════════════════════════════════════════════════════════
const t1 = box.composeTopBorder(20, "L", "R", nopaint, true);
check("compose: corners + slots", t1.startsWith("╭") && t1.endsWith("╮") && t1.includes("L") && t1.includes("R"), t1);
check("compose: exact visible width (corners)", vw(t1) === 20, `${t1} -> ${vw(t1)}`);

const t2 = box.composeTopBorder(20, "", "", nopaint, false);
check("compose: empty slots → all dashes, no corners",
  t2 === "─".repeat(20), t2);

const t3 = box.composeTopBorder(30, "⠋ Streaming", "deepseek · v4:high", nopaint, true);
check("compose: left slot before right slot",
  t3.indexOf("Streaming") < t3.indexOf("deepseek"), t3);
check("compose: exact visible width with slots", vw(t3) === 30, `${t3} -> ${vw(t3)}`);

// overflow: left truncated with …, width preserved
const t4 = box.composeTopBorder(16, "verylongstatusmessage", "model", nopaint, true);
check("compose: overflow keeps width", vw(t4) === 16, `${t4} -> ${vw(t4)}`);
check("compose: overflow truncates left with …", t4.includes("…"), t4);
check("compose: overflow keeps right slot", t4.includes("model"), t4);

// tiny widths
check("compose: width 2 corners", vw(box.composeTopBorder(2, "", "", nopaint, true)) === 2);
check("compose: width 1 no corners", vw(box.composeTopBorder(1, "", "", nopaint, false)) === 1);

// ══════════════════════════════════════════════════════════════
// 4. truncateVisible
// ══════════════════════════════════════════════════════════════
check("truncate: under budget untouched",
  box.truncateVisible("abc", 5) === "abc");
check("truncate: cut appends …",
  box.truncateVisible("abcdef", 4) === "abc…", box.truncateVisible("abcdef", 4));
check("truncate: SGR passes through uncounted",
  box.stripSgr(box.truncateVisible("\x1b[31mabcdef\x1b[0m", 4)).includes("…"));

// ══════════════════════════════════════════════════════════════
// 5. config — defaults, merge, save/load round trip
// ══════════════════════════════════════════════════════════════
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "muselinn-tui-test-"));
const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "muselinn-tui-cwd-"));
const savedHome = process.env.HOME;
const savedProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

const def = config.loadTuiConfig(tmpCwd);
check("config: missing files → defaults (boxed)",
  def.style === "boxed" && def.modelInBorder === false, JSON.stringify(def));

check("config: save writes global file",
  config.saveTuiConfig({ style: "compact", modelInBorder: false }) === true);
const reloaded = config.loadTuiConfig(tmpCwd);
check("config: saved values reload",
  reloaded.style === "compact", JSON.stringify(reloaded));

// modelInBorder opt-in flag
config.saveTuiConfig({ style: "boxed", modelInBorder: true });
check("config: modelInBorder true persists",
  config.loadTuiConfig(tmpCwd).modelInBorder === true);
fs.writeFileSync(path.join(tmpHome, ".pi", "agent", "muselinn-tui.json"),
  JSON.stringify({ modelInBorder: "yes" }), "utf-8");
check("config: non-boolean modelInBorder → default false",
  config.loadTuiConfig(fs.mkdtempSync(path.join(os.tmpdir(), "muselinn-tui-cwd3-"))).modelInBorder === false);
// restore the style used by the project-override checks below
config.saveTuiConfig({ style: "compact", modelInBorder: false });

// project overrides global
fs.mkdirSync(path.join(tmpCwd, ".pi"), { recursive: true });
fs.writeFileSync(path.join(tmpCwd, ".pi", "muselinn-tui.json"),
  JSON.stringify({ style: "plain", modelInBorder: "bogus" }), "utf-8");
const merged = config.loadTuiConfig(tmpCwd);
check("config: project overrides global style",
  merged.style === "plain", JSON.stringify(merged));
check("config: invalid project modelInBorder falls back to global",
  merged.modelInBorder === false, JSON.stringify(merged));

// invalid global values fall back to defaults
fs.writeFileSync(path.join(tmpHome, ".pi", "agent", "muselinn-tui.json"),
  JSON.stringify({ style: "weird", layout: 42 }), "utf-8");
const sane = config.loadTuiConfig(fs.mkdtempSync(path.join(os.tmpdir(), "muselinn-tui-cwd2-")));
check("config: invalid global values → defaults",
  sane.style === "boxed" && sane.modelInBorder === false, JSON.stringify(sane));

process.env.HOME = savedHome;
process.env.USERPROFILE = savedProfile;

// ══════════════════════════════════════════════════════════════
// 6. timing probe
// ══════════════════════════════════════════════════════════════
const rt = new timing.RenderTiming(5);
for (const ms of [10, 20, 30, 40, 50, 60, 70]) rt.record("editor", ms);
const st = rt.stats("editor");
check("timing: ring capped at 5", st.count === 5, String(st.count));
check("timing: p50 = median of kept samples", st.p50 === 50, String(st.p50));
check("timing: mean over kept samples", st.mean === 50, String(st.mean));
check("timing: unknown probe → null", rt.stats("nope") === null);
check("timing: format includes probe name", rt.format().includes("editor:"));
rt.reset();
check("timing: reset clears", rt.format() === "timing: no samples yet");

timing.setTimingEnabledForTests(true);
check("timing: gate forced on", timing.isTimingEnabled() === true);
timing.setTimingEnabledForTests(false);
check("timing: gate forced off", timing.isTimingEnabled() === false);
timing.setTimingEnabledForTests(null); // back to env (off in tests)

// ══════════════════════════════════════════════════════════════
// 7. /tui arg parsing
// ══════════════════════════════════════════════════════════════
check("parse: empty → status", parse.parseTuiArgs("").kind === "status");
check("parse: status keyword", parse.parseTuiArgs("status").kind === "status");
check("parse: style boxed",
  parse.parseTuiArgs("style boxed").kind === "style" && parse.parseTuiArgs("style boxed").style === "boxed");
check("parse: style case-insensitive",
  parse.parseTuiArgs("STYLE Compact").kind === "style" && parse.parseTuiArgs("STYLE Compact").style === "compact");
check("parse: bad style → error", parse.parseTuiArgs("style fancy").kind === "error");
check("parse: missing style arg → error", parse.parseTuiArgs("style").kind === "error");
check("parse: removed layout subcommand → error", parse.parseTuiArgs("fullscreen").kind === "error");
check("parse: unknown subcommand → error", parse.parseTuiArgs("banana").kind === "error");
check("parse: timing", parse.parseTuiArgs("timing").kind === "timing");

// ══════════════════════════════════════════════════════════════
// 8. /tui completions
// ══════════════════════════════════════════════════════════════
const tcomp = completions.tuiArgumentCompletions;
check("completions: empty → all subcommands",
  tcomp("").length === 2, String(tcomp("").length));
check("completions: prefix filters",
  tcomp("t").length === 1 && tcomp("t")[0].value === "timing", JSON.stringify(tcomp("t")));
check("completions: style prefix → full-string values",
  tcomp("style ").every((i) => i.value.startsWith("style ")) && tcomp("style ").length === 3,
  JSON.stringify(tcomp("style ")));
check("completions: style partial filters",
  tcomp("style b").length === 1 && tcomp("style b")[0].value === "style boxed");
check("completions: non-style two tokens → null",
  tcomp("timing x") === null);

// ══════════════════════════════════════════════════════════════
// 9. style switch planning — round-trip restore contract
// ══════════════════════════════════════════════════════════════
check("switch: plain unregisters factory + restores working indicator",
  (() => { const p = switchMod.planStyleSwitch("plain"); return p.registerFactory === false && p.workingVisible === true; })());
check("switch: boxed registers factory + hides working indicator",
  (() => { const p = switchMod.planStyleSwitch("boxed"); return p.registerFactory === true && p.workingVisible === false; })());
check("switch: compact registers factory + hides working indicator",
  (() => { const p = switchMod.planStyleSwitch("compact"); return p.registerFactory === true && p.workingVisible === false; })());

// round trip: boxed → plain → boxed ends with a factory registration
const roundTrip = ["boxed", "plain", "boxed"].map(switchMod.planStyleSwitch);
check("switch: style round trip ends registered",
  roundTrip[2].registerFactory === true && roundTrip[1].registerFactory === false);

// ══════════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
