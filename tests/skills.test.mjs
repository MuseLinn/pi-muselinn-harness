// Skills scanner unit tests (pure, no pi runtime, no model quota).
// Same jiti.transform CJS loader as tests/permission.test.mjs.
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

// ── Environment isolation: never touch the real ~/.kimi-code or ~/.agents ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
const userHome = path.join(tmp, "home");
const kimiHome = path.join(tmp, "kimi-home");
fs.mkdirSync(userHome, { recursive: true });
fs.mkdirSync(kimiHome, { recursive: true });
process.env.HOME = userHome;
process.env.USERPROFILE = userHome;
process.env.KIMI_CODE_HOME = kimiHome;

const EXT = "C:/Users/unive/.pi/agent/extensions/pi-muselinn-harness";
const { loadSkillsForCwd, findProjectRoot, listSkillRootDirs, clearSkillsCache } = loadTs(`${EXT}/skills/index.ts`);

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

// ── Fixture tree ─────────────────────────────────────────────────────
// project/                 (has .git → project root)
//   .kimi-code/skills/     (project scope, priority 1)
//   .agents/skills/        (project scope, priority 2)
//   nested/deep/           (cwd variant: walks up to project/)
// kimi-home/skills/        (user scope via $KIMI_CODE_HOME, priority 3)
// home/.agents/skills/     (user scope, priority 4)
// nogit/                   (no .git anywhere above inside tmp → root = cwd)
//   .kimi-code/skills/
const project = path.join(tmp, "project");
fs.mkdirSync(path.join(project, ".git"), { recursive: true });
const projKimiSkills = path.join(project, ".kimi-code", "skills");
const projAgentsSkills = path.join(project, ".agents", "skills");
const userKimiSkills = path.join(kimiHome, "skills");
const userAgentsSkills = path.join(userHome, ".agents", "skills");

// 1. Directory-form skill with full frontmatter (kebab/snake variants).
write(path.join(projKimiSkills, "review", "SKILL.md"), [
  "---",
  "name: code-review",
  "description: Review code for defects",
  "when-to-use: when reviewing pull requests",
  "disable-model-invocation: true",
  "arguments:",
  "  - path",
  "  - depth",
  "---",
  "",
  "Body text here.",
].join("\n"));

// Helper file riding along in the skill dir (auxiliary file, not a skill).
write(path.join(projKimiSkills, "review", "checklist.txt"), "a,b,c");

// 2. Flat-form skill: no frontmatter → name from filename, description from body.
write(path.join(projKimiSkills, "quick-note.md"), "\n\nJot down a quick note about the repo.\nMore detail.\n");

// 3. Flat-form with camelCase variants + inline array arguments.
write(path.join(projKimiSkills, "lint.md"), [
  "---",
  "when_to_use: when linting",
  "disable_model_invocation: false",
  "arguments: [target, fix]",
  "---",
  "Lint the codebase.",
].join("\n"));

// 4. type: flow → manual invocation only (disableModelInvocation forced true).
write(path.join(projKimiSkills, "deploy", "SKILL.md"), [
  "---",
  "name: deploy",
  "description: Deploy the app",
  "type: flow",
  "---",
].join("\n"));

// 5. type: inline → synonym of prompt (kept, not disabled).
write(path.join(projKimiSkills, "summarize", "SKILL.md"), [
  "---",
  "name: summarize",
  "description: Summarize a file",
  "type: inline",
  "---",
].join("\n"));

// 6. Invalid type → skipped with a warning diagnostic.
write(path.join(projKimiSkills, "broken", "SKILL.md"), [
  "---",
  "name: broken",
  "description: Should be skipped",
  "type: webhook",
  "---",
].join("\n"));

// 7. Same name in project and user scope → project wins + collision diagnostic.
write(path.join(userKimiSkills, "review", "SKILL.md"), [
  "---",
  "name: code-review",
  "description: USER-SCOPE DUPLICATE",
  "---",
].join("\n"));

// 8. User-scope-only skills in both user dirs.
write(path.join(userKimiSkills, "global-tool", "SKILL.md"), [
  "---",
  "name: global-tool",
  "description: A user-level tool",
  "---",
].join("\n"));
write(path.join(userAgentsSkills, "shared.md"), "Shared across agents.\n");

// 9. dir-form + flat-form same name in one directory → subdir wins silently.
write(path.join(projAgentsSkills, "dup", "SKILL.md"), [
  "---",
  "name: dup",
  "description: DIRECTORY FORM WINS",
  "---",
].join("\n"));
write(path.join(projAgentsSkills, "dup.md"), "---\nname: dup\ndescription: flat loser\n---\n");

// 10. Nested skill root discovery (recursion into subdirectories).
write(path.join(projAgentsSkills, "group", "nested-thing", "SKILL.md"), [
  "---",
  "name: nested-thing",
  "description: Found by recursion",
  "---",
].join("\n"));

// 11. Long body line → description fallback truncated to 240 chars.
write(path.join(projAgentsSkills, "longdesc.md"), "x".repeat(300) + "\n");

// 12. arguments as whitespace-separated string.
write(path.join(projAgentsSkills, "wsargs.md"), [
  "---",
  "arguments: alpha  beta   gamma",
  "---",
  "Whitespace args skill.",
].join("\n"));

// ── Tests ────────────────────────────────────────────────────────────

// Project root discovery
check("findProjectRoot: walks up to .git ancestor",
  findProjectRoot(path.join(project, "nested", "deep")) === project);
const nogit = path.join(tmp, "nogit");
fs.mkdirSync(path.join(nogit, ".kimi-code", "skills"), { recursive: true });
check("findProjectRoot: no .git → cwd itself", findProjectRoot(nogit) === nogit);

// Scope ordering
const roots = listSkillRootDirs(path.join(project, "nested"));
check("four scopes listed, project first",
  roots.length === 4 &&
  roots[0].dir === projKimiSkills && roots[0].source === "project" &&
  roots[1].dir === projAgentsSkills && roots[1].source === "project" &&
  roots[2].dir === userKimiSkills && roots[2].source === "user" &&
  roots[3].dir === userAgentsSkills && roots[3].source === "user");

const result = loadSkillsForCwd(path.join(project, "nested", "deep"));
const byName = new Map(result.skills.map((s) => [s.name, s]));

// 1. directory-form parse + variant keys + block-array arguments
const review = byName.get("code-review");
check("dir-form: parsed with frontmatter name/description",
  !!review && review.description === "Review code for defects");
check("dir-form: when-to-use variant honored", review?.whenToUse === "when reviewing pull requests");
check("dir-form: disable-model-invocation variant honored", review?.disableModelInvocation === true);
check("dir-form: block-array arguments", JSON.stringify(review?.arguments) === JSON.stringify(["path", "depth"]));
check("dir-form: filePath/baseDir/sourceInfo",
  review?.filePath === path.join(projKimiSkills, "review", "SKILL.md") &&
  review?.baseDir === path.join(projKimiSkills, "review") &&
  review?.sourceInfo?.source === "project" &&
  review?.sourceInfo?.scope === "project");

// 2. flat-form fallbacks
const quickNote = byName.get("quick-note");
check("flat-form: name from filename, description from first body line",
  !!quickNote && quickNote.description === "Jot down a quick note about the repo.");
check("flat-form: default type prompt → model-invocable", quickNote?.disableModelInvocation === false);

// 3. camelCase variants + inline array
const lint = byName.get("lint");
check("flat-form: when_to_use + inline [a, b] arguments + body fallback desc",
  lint?.whenToUse === "when linting" &&
  lint?.disableModelInvocation === false &&
  JSON.stringify(lint?.arguments) === JSON.stringify(["target", "fix"]) &&
  lint?.description === "Lint the codebase.");

// 4. flow type
check("type flow → disableModelInvocation forced true", byName.get("deploy")?.disableModelInvocation === true);

// 5. inline type
check("type inline → kept, not disabled", byName.get("summarize")?.disableModelInvocation === false);

// 6. invalid type skipped
check("invalid type skipped", !byName.has("broken"));
check("invalid type → warning diagnostic",
  result.diagnostics.some((d) => d.type === "warning" && /unsupported type/.test(d.message)));

// 7. project-over-user dedupe + collision diagnostic
check("dedupe: project scope wins over user scope",
  byName.get("code-review")?.description === "Review code for defects");
const collisions = result.diagnostics.filter((d) => d.type === "collision");
check("dedupe: collision diagnostic recorded",
  collisions.some((d) => d.collision?.name === "code-review" &&
    d.collision?.winnerSource === "project" && d.collision?.loserSource === "user"));

// 8. user-scope skills load from both user dirs
check("user scope: $KIMI_CODE_HOME/skills loaded",
  byName.get("global-tool")?.sourceInfo?.source === "user");
check("user scope: ~/.agents/skills flat file loaded",
  byName.get("shared")?.description === "Shared across agents.");

// 9. dir-form beats flat-form silently
check("dir-form beats flat <name>.md in same dir",
  byName.get("dup")?.description === "DIRECTORY FORM WINS");
check("dir/flat coexistence → no collision diagnostic for it",
  !collisions.some((d) => d.collision?.name === "dup"));

// 10. recursion
check("recursion: nested skill root found", byName.get("nested-thing")?.description === "Found by recursion");

// 11. 240-char truncation
check("description fallback truncated to 240 chars",
  byName.get("longdesc")?.description?.length === 240);

// 12. whitespace-separated arguments string
check("arguments: whitespace-separated string form",
  JSON.stringify(byName.get("wsargs")?.arguments) === JSON.stringify(["alpha", "beta", "gamma"]));

// 12. no-.git project: cwd is the root
write(path.join(nogit, ".kimi-code", "skills", "local.md"), "Local-only skill.\n");
const nogitResult = loadSkillsForCwd(nogit);
check("no .git → cwd used as project root, project skills load",
  nogitResult.skills.some((s) => s.name === "local" && s.sourceInfo.source === "project"));

// 13. cache: second call returns identical content (cache hit), and
// adding a skill file invalidates via directory mtime change.
const cacheProject = path.join(tmp, "cache-proj");
fs.mkdirSync(path.join(cacheProject, ".git"), { recursive: true });
write(path.join(cacheProject, ".kimi-code", "skills", "one.md"), "First skill.\n");
const before = loadSkillsForCwd(cacheProject);
check("cache fixture: one skill initially",
  before.skills.filter((s) => s.sourceInfo.source === "project").length === 1);
// Busy-wait a tick so directory mtime moves even on coarse filesystems.
const spinUntil = Date.now() + 20;
while (Date.now() < spinUntil) { /* wait */ }
write(path.join(cacheProject, ".kimi-code", "skills", "two.md"), "Second skill.\n");
const after = loadSkillsForCwd(cacheProject);
check("cache: new file invalidates (dir mtime change)",
  after.skills.some((s) => s.name === "two"));
clearSkillsCache();
const afterClear = loadSkillsForCwd(cacheProject);
check("cache: clearSkillsCache forces rescan",
  afterClear.skills.some((s) => s.name === "two"));

// ── Cleanup ──────────────────────────────────────────────────────────
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
