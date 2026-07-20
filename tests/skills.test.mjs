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

// ── Environment isolation: never touch the real ~/.kimi-code or ~/.agents ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skills-test-"));
const userHome = path.join(tmp, "home");
const kimiHome = path.join(tmp, "kimi-home");
fs.mkdirSync(userHome, { recursive: true });
fs.mkdirSync(kimiHome, { recursive: true });
process.env.HOME = userHome;
process.env.USERPROFILE = userHome;
process.env.KIMI_CODE_HOME = kimiHome;

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const { loadSkillsForCwd, findProjectRoot, listSkillRootDirs, clearSkillsCache } = loadTs(`${EXT}/packages/core/skills/index.ts`);

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

// Scope ordering (pi-native dirs first at each level, Kimi Code compat after)
const roots = listSkillRootDirs(path.join(project, "nested"));
check("seven scopes listed, project first, pi-native before kimi compat",
  roots.length === 7 &&
  roots[0].dir === path.join(project, ".pi", "skills") && roots[0].source === "project" &&
  roots[1].dir === projKimiSkills && roots[1].source === "project" &&
  roots[2].dir === projAgentsSkills && roots[2].source === "project" &&
  roots[3].dir === path.join(userHome, ".pi", "agent", "skills") && roots[3].source === "user" &&
  roots[4].dir === path.join(userHome, ".pi", "skills") && roots[4].source === "user" &&
  roots[5].dir === userKimiSkills && roots[5].source === "user" &&
  roots[6].dir === userAgentsSkills && roots[6].source === "user");

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

// 13. pi-native scopes: project .pi/skills wins over project .kimi-code,
// and user ~/.pi/agent/skills loads.
const piProject = path.join(tmp, "pi-proj");
fs.mkdirSync(path.join(piProject, ".git"), { recursive: true });
write(path.join(piProject, ".pi", "skills", "dual.md"), "From pi-native project scope.\n");
write(path.join(piProject, ".kimi-code", "skills", "dual.md"), "From kimi compat scope.\n");
write(path.join(userHome, ".pi", "agent", "skills", "pi-user.md"), "Pi-native user skill.\n");
const piResult = loadSkillsForCwd(piProject);
const piByName = new Map(piResult.skills.map((s) => [s.name, s]));
check("pi scope: project .pi/skills wins over .kimi-code compat",
  piByName.get("dual")?.description === "From pi-native project scope." &&
  piByName.get("dual")?.filePath === path.join(piProject, ".pi", "skills", "dual.md"));
check("pi scope: compat collision diagnostic recorded",
  piResult.diagnostics.some((d) => d.type === "collision" && d.collision?.name === "dual"));
check("pi scope: user ~/.pi/agent/skills loaded",
  piByName.get("pi-user")?.sourceInfo?.source === "user");
// Clean up the shared user-scope fixture so later assertions are unaffected.
fs.rmSync(path.join(userHome, ".pi"), { recursive: true, force: true });
clearSkillsCache();

// 14. cache: second call returns identical content (cache hit), and
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

// ── listDiscoverableSkillFiles: pi-native dirs win, compat dirs deduped ──
// Separate env root so the shared fixture's scope counts are untouched.
{
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "skills-discover-"));
  const home2 = path.join(tmp2, "home");
  const kimiHome2 = path.join(tmp2, "kimi-home");
  const project2 = path.join(tmp2, "project2");
  fs.mkdirSync(path.join(project2, ".git"), { recursive: true });

  write(path.join(home2, ".agents", "skills", "webbridge", "SKILL.md"),
    "---\nname: kimi-webbridge\ndescription: agents copy\n---\n");
  write(path.join(kimiHome2, "skills", "webbridge", "SKILL.md"),
    "---\nname: kimi-webbridge\ndescription: kimi copy (should lose)\n---\n");
  write(path.join(kimiHome2, "skills", "unique-tool", "SKILL.md"),
    "---\nname: unique-tool\ndescription: only in kimi home\n---\n");
  write(path.join(project2, ".kimi-code", "skills", "proj-skill.md"), "Project-only skill.\n");
  write(path.join(home2, ".pi", "skills", "pi-extra.md"), "User .pi skills dir.\n");

  const savedEnv = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, KIMI_CODE_HOME: process.env.KIMI_CODE_HOME };
  process.env.HOME = home2;
  process.env.USERPROFILE = home2;
  process.env.KIMI_CODE_HOME = kimiHome2;

  const { listDiscoverableSkillFiles } = loadTs(`${EXT}/packages/core/skills/index.ts`);
  const files = listDiscoverableSkillFiles(project2);

  check("discover: pi-native ~/.agents name beats ~/.kimi-code same-named skill",
    !files.some((f) => f.includes("kimi-home") && f.includes("webbridge")), JSON.stringify(files));
  check("discover: unique kimi-home skill included",
    files.some((f) => f.endsWith(path.join("unique-tool", "SKILL.md"))), JSON.stringify(files));
  check("discover: project .kimi-code skill included",
    files.some((f) => f.includes("project2") && f.endsWith("proj-skill.md")), JSON.stringify(files));
  check("discover: ~/.pi/skills included",
    files.some((f) => f.endsWith("pi-extra.md")), JSON.stringify(files));
  check("discover: project scope comes before user scope",
    files.length > 0 && files[0].includes("project2"), JSON.stringify(files));
  check("discover: returns .md file paths, not dirs",
    files.every((f) => f.endsWith(".md")), JSON.stringify(files));
  check("discover: no pi-native dir files returned",
    !files.some((f) => f.includes(path.join(".agents", "skills"))), JSON.stringify(files));

  process.env.HOME = savedEnv.HOME;
  process.env.USERPROFILE = savedEnv.USERPROFILE;
  process.env.KIMI_CODE_HOME = savedEnv.KIMI_CODE_HOME;
  try { fs.rmSync(tmp2, { recursive: true, force: true }); } catch { /* ok */ }
}

// ── Cleanup ──────────────────────────────────────────────────────────
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ok */ }

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
