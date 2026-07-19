// Math rendering unit tests (pure, no pi runtime, no txm binary needed).
// Covers: $$ block splitting (code fences untouched), fail-open
// reassembly with an injected renderer, config math flag, /tui math
// parsing + completions. Uses the same jiti.transform CJS loader as
// tests/tui.test.mjs.
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
  moduleCache.set(key, module);
  const localRequire = (spec) => {
    const r = resolveSpec(spec, key);
    return r.native ? nativeRequire(spec) : loadTs(r.file);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", code)(
    module.exports, localRequire, module, key, path.dirname(key));
  return module.exports;
}

const EXT = "C:/Users/unive/.pi/agent/extensions/pi-muselinn-harness";
const split = loadTs(`${EXT}/math/split.ts`);
const config = loadTs(`${EXT}/tui/config.ts`);
const parse = loadTs(`${EXT}/tui/parse.ts`);
const completions = loadTs(`${EXT}/completions.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ══════════════════════════════════════════════════════════════
// 1. hasDisplayMath / extractTex
// ══════════════════════════════════════════════════════════════
check("has: $$ block detected", split.hasDisplayMath("foo $$E=mc^2$$ bar") === true);
check("has: single $ ignored (v1)", split.hasDisplayMath("foo $E=mc^2$ bar") === false);
check("has: no math", split.hasDisplayMath("plain text") === false);
check("extract: delimiters stripped", split.extractTex("$$\nE = mc^2\n$$") === "E = mc^2");

// ══════════════════════════════════════════════════════════════
// 2. splitMathBlocks
// ══════════════════════════════════════════════════════════════
const segs = split.splitMathBlocks("before $$x^2$$ middle $$y^2$$ after");
check("split: 5 segments", segs.length === 5, String(segs.length));
check("split: math segments typed",
  segs[1].type === "math" && segs[3].type === "math" && segs[1].text === "$$x^2$$");

// fenced code blocks stay markdown — formula inside never rendered
const code = split.splitMathBlocks("```\n$$not math$$\n```\nreal: $$yes$$");
check("split: fenced code is markdown",
  code.filter((s) => s.type === "math").length === 1, JSON.stringify(code.map((s) => s.type)));
check("split: fenced content preserved verbatim",
  code.some((s) => s.type === "markdown" && s.text.includes("$$not math$$")));

// tilde fences too
check("split: ~~~ fences treated as code",
  split.splitMathBlocks("~~~\n$$nope$$\n~~~").every((s) => s.type === "markdown"));

// unclosed $$ stays markdown
const unclosed = split.splitMathBlocks("before $$never closed");
check("split: unclosed $$ stays markdown",
  unclosed.every((s) => s.type === "markdown"));

// ══════════════════════════════════════════════════════════════
// 3. renderMathInMarkdown — injected renderer, fail-open
// ══════════════════════════════════════════════════════════════
const okRenderer = async (tex) => `[RENDERED:${tex}]`;
const nullRenderer = async () => null;

const rendered = await split.renderMathInMarkdown("a $$x^2$$ b", okRenderer);
check("render: success replaces block",
  rendered === "a \n[RENDERED:x^2]\n b", rendered);

const kept = await split.renderMathInMarkdown("a $$x^2$$ b", nullRenderer);
check("render: null keeps original LaTeX (fail-open)",
  kept === "a $$x^2$$ b", kept);

// code-fence content never reaches the renderer
let rendererCalls = 0;
const counting = async (tex) => { rendererCalls++; return "X"; };
await split.renderMathInMarkdown("```\n$$skip$$\n```\n$$hit$$", counting);
check("render: fenced formulas never reach renderer",
  rendererCalls === 1, String(rendererCalls));

// no math → string identity (no renderer calls, no reformat)
const noMath = "plain **markdown** text";
check("render: no math → identity",
  (await split.renderMathInMarkdown(noMath, okRenderer)) === noMath);

// ══════════════════════════════════════════════════════════════
// 4. config math flag
// ══════════════════════════════════════════════════════════════
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "muselinn-math-test-"));
const tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "muselinn-math-cwd-"));
const savedHome = process.env.HOME;
const savedProfile = process.env.USERPROFILE;
process.env.HOME = tmpHome;
process.env.USERPROFILE = tmpHome;

check("config: math defaults to true",
  config.loadTuiConfig(tmpCwd).math === true);
config.saveTuiConfig({ style: "boxed", modelInBorder: false, math: false });
check("config: math false persists",
  config.loadTuiConfig(tmpCwd).math === false);
fs.writeFileSync(config.globalTuiConfigPath(), JSON.stringify({ math: "no" }), "utf-8");
check("config: non-boolean math → default true",
  config.loadTuiConfig(tmpCwd).math === true);

process.env.HOME = savedHome;
process.env.USERPROFILE = savedProfile;

// ══════════════════════════════════════════════════════════════
// 5. /tui math parsing + completions
// ══════════════════════════════════════════════════════════════
check("parse: math on",
  parse.parseTuiArgs("math on").kind === "math" && parse.parseTuiArgs("math on").enabled === true);
check("parse: math off",
  parse.parseTuiArgs("math off").kind === "math" && parse.parseTuiArgs("math off").enabled === false);
check("parse: math bare → error", parse.parseTuiArgs("math").kind === "error");
check("parse: math bad value → error", parse.parseTuiArgs("math maybe").kind === "error");

const tcomp = completions.tuiArgumentCompletions;
check("completions: empty → 3 subcommands", tcomp("").length === 3, String(tcomp("").length));
check("completions: math prefix → on/off full values",
  tcomp("math ").length === 2 && tcomp("math ").every((i) => i.value.startsWith("math ")),
  JSON.stringify(tcomp("math ")));
check("completions: math partial filters",
  tcomp("math o").length === 2 && tcomp("math of").length === 1 && tcomp("math of")[0].value === "math off",
  JSON.stringify(tcomp("math of")));

// ══════════════════════════════════════════════════════════════
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
