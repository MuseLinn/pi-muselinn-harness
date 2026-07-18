// ============================================================
// Skills — Kimi Code-style Agent Skills scanner
// ============================================================
// Four-scope layout (project wins over user):
//   project root (nearest ancestor of cwd containing .git, else cwd):
//     .kimi-code/skills/   .agents/skills/
//   user:
//     $KIMI_CODE_HOME/skills/ (default ~/.kimi-code/skills/)
//     ~/.agents/skills/
//
// Scan rules (aligned with pi's loadSkillsFromDir):
//   - a directory containing SKILL.md is a skill root; do not recurse further
//   - otherwise load direct .md children as flat skills (name = filename)
//   - recurse into subdirectories looking for SKILL.md
//   - directory-form beats flat-form for the same name within one directory
//   - dedupe by name across scopes: first loader wins, losers get a
//     collision diagnostic
//
// Caching: per skills-root-dir, keyed on the mtimes of every directory
// encountered during the scan (directory mtime changes when children are
// added/removed/renamed — cheap and sufficient, same trade-off as
// permission/config.ts's file-mtime cache).

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter, fallbackDescription, getField, normalizeArguments } from "./frontmatter";

// pi's Skill shape (duck-typed to avoid a hard runtime dep on pi here; the
// object is fed straight into resourceLoader.getSkills).
export interface KimiSkill {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  sourceInfo: {
    path: string;
    source: "user" | "project" | "path";
    scope: "user" | "project" | "temporary";
    origin: "package" | "top-level";
    baseDir?: string;
  };
  disableModelInvocation: boolean;
  // Kimi Code extensions carried as extra metadata (ignored by pi).
  whenToUse?: string;
  arguments?: string[];
}

export interface SkillDiagnostic {
  type: "warning" | "error" | "collision";
  message: string;
  path?: string;
  collision?: {
    resourceType: "skill";
    name: string;
    winnerPath: string;
    loserPath: string;
    winnerSource?: string;
    loserSource?: string;
  };
}

export interface LoadSkillsResult {
  skills: KimiSkill[];
  diagnostics: SkillDiagnostic[];
}

export interface SkillRootDir {
  dir: string;
  source: "user" | "project";
}

/** Nearest ancestor of cwd containing .git (the Kimi Code project root), else cwd itself. */
export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (true) {
    try {
      if (fs.existsSync(path.join(dir, ".git"))) return dir;
    } catch { /* keep walking */ }
    if (dir === root) return path.resolve(cwd);
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

/** Ordered skills root dirs, project scope first (priority order). */
export function listSkillRootDirs(cwd: string): SkillRootDir[] {
  const projectRoot = findProjectRoot(cwd);
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  const kimiHome = process.env.KIMI_CODE_HOME || path.join(home, ".kimi-code");
  return [
    { dir: path.join(projectRoot, ".kimi-code", "skills"), source: "project" },
    { dir: path.join(projectRoot, ".agents", "skills"), source: "project" },
    { dir: path.join(kimiHome, "skills"), source: "user" },
    { dir: path.join(home, ".agents", "skills"), source: "user" },
  ];
}

/** Existing dirs only — used by the resources_discover main-session hook. */
export function listExistingSkillDirs(cwd: string): string[] {
  return listSkillRootDirs(cwd)
    .map((r) => r.dir)
    .filter((d) => {
      try { return fs.statSync(d).isDirectory(); } catch { return false; }
    });
}

// ------------------------------------------------------------
// Frontmatter → Skill
// ------------------------------------------------------------

function buildSkill(opts: {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: "user" | "project";
  disableModelInvocation: boolean;
  whenToUse?: string;
  args?: string[];
}): KimiSkill {
  const skill: KimiSkill = {
    name: opts.name,
    description: opts.description,
    filePath: opts.filePath,
    baseDir: opts.baseDir,
    sourceInfo: {
      path: opts.filePath,
      source: opts.source,
      scope: opts.source === "project" ? "project" : "user",
      origin: "top-level",
      baseDir: opts.baseDir,
    },
    disableModelInvocation: opts.disableModelInvocation,
  };
  if (opts.whenToUse) skill.whenToUse = opts.whenToUse;
  if (opts.args) skill.arguments = opts.args;
  return skill;
}

interface ParsedSkillFile {
  skill?: KimiSkill;
  diagnostic?: SkillDiagnostic;
}

/**
 * Parse one skill file (SKILL.md inside a skill dir, or a flat .md file).
 * `dirName` is the containing directory's basename — the fallback name for
 * directory-form skills; `flatName` is set for flat .md files (filename
 * without extension), where name/description may be omitted entirely.
 */
function parseSkillFile(
  filePath: string,
  baseDir: string,
  source: "user" | "project",
  fallbacks: { dirName: string; flatName?: string },
): ParsedSkillFile {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (e: any) {
    return { diagnostic: { type: "warning", message: `skill unreadable: ${e?.message || e}`, path: filePath } };
  }
  const { data, body } = parseFrontmatter(content);

  // type: prompt (default) / inline (synonym) / flow (manual invocation only).
  // Any other value → skip this skill entirely.
  const rawType = getField(data, "type");
  const type = (typeof rawType === "string" && rawType.trim() !== "" ? rawType.trim() : "prompt").toLowerCase();
  if (type !== "prompt" && type !== "inline" && type !== "flow") {
    return {
      diagnostic: {
        type: "warning",
        message: `skill skipped: unsupported type "${rawType}" (expected prompt|inline|flow)`,
        path: filePath,
      },
    };
  }

  const rawName = getField(data, "name");
  const name = typeof rawName === "string" && rawName.trim() !== ""
    ? rawName.trim()
    : (fallbacks.flatName ?? fallbacks.dirName);

  const rawDesc = getField(data, "description");
  const description = typeof rawDesc === "string" && rawDesc.trim() !== ""
    ? rawDesc.trim()
    : fallbackDescription(body);

  const rawDisable = getField(data, "disableModelInvocation", "disable-model-invocation", "disable_model_invocation");
  let disableModelInvocation = rawDisable === true || rawDisable === "true";
  if (type === "flow") disableModelInvocation = true; // flow = manual invocation only

  const rawWhen = getField(data, "whenToUse", "when-to-use", "when_to_use");
  const whenToUse = typeof rawWhen === "string" && rawWhen.trim() !== "" ? rawWhen.trim() : undefined;

  const args = normalizeArguments(getField(data, "arguments"));

  return {
    skill: buildSkill({
      name,
      description,
      filePath,
      baseDir,
      source,
      disableModelInvocation,
      whenToUse,
      args,
    }),
  };
}

// ------------------------------------------------------------
// Directory scanning (pi rules)
// ------------------------------------------------------------

interface ScanOut {
  skills: KimiSkill[];
  diagnostics: SkillDiagnostic[];
}

function isDir(p: string): boolean {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

function isFile(p: string): boolean {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * Scan one directory (not necessarily a skills root):
 *  - SKILL.md here → skill root, stop recursing
 *  - else: recurse subdirectories first, then direct .md children;
 *    a flat <name>.md loses silently to a <name>/SKILL.md in the same dir.
 */
function scanDir(dir: string, source: "user" | "project", out: ScanOut, seenNames: Set<string>): void {
  const skillMd = path.join(dir, "SKILL.md");
  if (isFile(skillMd)) {
    const parsed = parseSkillFile(skillMd, dir, source, { dirName: path.basename(dir) });
    if (parsed.skill) pushSkill(parsed.skill, out, seenNames);
    if (parsed.diagnostic) out.diagnostics.push(parsed.diagnostic);
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  // Pass 1: subdirectories (recursion may hit nested SKILL.md roots).
  // Track direct subdirectory names so pass 2 can silently drop a flat
  // <name>.md when a <name>/ sibling exists (directory-form wins).
  const directSubdirNames = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    directSubdirNames.add(entry.name);
    scanDir(path.join(dir, entry.name), source, out, seenNames);
  }

  // Pass 2: direct flat .md children.
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".md")) continue;
    if (entry.name.toUpperCase() === "SKILL.MD") continue; // case-insensitive guard
    const flatName = entry.name.replace(/\.md$/i, "");
    if (directSubdirNames.has(flatName)) continue; // directory-form wins, no diagnostic
    const filePath = path.join(dir, entry.name);
    const parsed = parseSkillFile(filePath, dir, source, { dirName: path.basename(dir), flatName });
    if (parsed.skill) pushSkill(parsed.skill, out, seenNames);
    if (parsed.diagnostic) out.diagnostics.push(parsed.diagnostic);
  }
}

/** Add a skill unless the name is already claimed; collisions become diagnostics. */
function pushSkill(skill: KimiSkill, out: ScanOut, seenNames: Set<string>): void {
  if (seenNames.has(skill.name)) {
    const winner = out.skills.find((s) => s.name === skill.name);
    out.diagnostics.push({
      type: "collision",
      message: `skill name collision: "${skill.name}" from ${skill.filePath} ignored (already provided by ${winner?.filePath ?? "earlier scope"})`,
      path: skill.filePath,
      collision: {
        resourceType: "skill",
        name: skill.name,
        winnerPath: winner?.filePath ?? "",
        loserPath: skill.filePath,
        winnerSource: winner?.sourceInfo.source,
        loserSource: skill.sourceInfo.source,
      },
    });
    return;
  }
  seenNames.add(skill.name);
  out.skills.push(skill);
}

// ------------------------------------------------------------
// mtime cache (permission/config.ts pattern, generalized to dir trees)
// ------------------------------------------------------------

interface RootCacheEntry {
  stamps: Map<string, number>; // dir path → mtimeMs (-1 = missing)
  result: ScanOut;
}

const rootCache = new Map<string, RootCacheEntry>();

/** Collect dir → mtimeMs for a root and every descendant directory. */
function collectDirStamps(root: string, stamps: Map<string, number>): void {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(root).mtimeMs;
  } catch { /* missing */ }
  stamps.set(root, mtimeMs);
  if (mtimeMs < 0) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) collectDirStamps(path.join(root, entry.name), stamps);
  }
}

function stampsEqual(a: Map<string, number>, b: Map<string, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

/** Test hook: drop all cached scans. */
export function clearSkillsCache(): void {
  rootCache.clear();
}

function scanRootCached(root: SkillRootDir): ScanOut {
  const stamps = new Map<string, number>();
  collectDirStamps(root.dir, stamps);
  const cached = rootCache.get(root.dir);
  if (cached && stampsEqual(cached.stamps, stamps)) return cached.result;

  const result: ScanOut = { skills: [], diagnostics: [] };
  if (isDir(root.dir)) {
    // Dedupe within the root uses a fresh per-root set; cross-scope dedupe
    // (project over user) happens in loadSkillsForCwd.
    scanDir(root.dir, root.source, result, new Set());
  }
  rootCache.set(root.dir, { stamps, result });
  return result;
}

// ------------------------------------------------------------
// Public entry point
// ------------------------------------------------------------

/**
 * Load Kimi Code Agent Skills for a cwd: project scopes first, then user
 * scopes; dedupe by name (first loader wins; losers → collision diagnostic).
 */
export function loadSkillsForCwd(cwd: string): LoadSkillsResult {
  const out: ScanOut = { skills: [], diagnostics: [] };
  const seenNames = new Set<string>();
  for (const root of listSkillRootDirs(cwd)) {
    const partial = scanRootCached(root);
    for (const d of partial.diagnostics) out.diagnostics.push(d);
    for (const skill of partial.skills) pushSkill(skill, out, seenNames);
  }
  return { skills: out.skills, diagnostics: out.diagnostics };
}
