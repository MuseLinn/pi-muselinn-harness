// ============================================================
// Hooks Config — minimal TOML parser + two-layer loading + mtime cache
//
// Kimi Code-aligned config locations:
//   1. $KIMI_CODE_HOME/config.toml (default ~/.kimi-code/config.toml)
//   2. Project level: nearest .kimi-code/config.toml walking up from cwd
// Project rules come first; both layers are merged.
//
// The TOML support is intentionally minimal — only what [[hooks]] needs:
//   - [[hooks]] array-of-tables headers
//   - event / matcher / command string values ("..." with basic escapes)
//   - timeout integer values (1-600, default 30)
//   - # comments (outside quoted strings)
// Anything unparseable, any entry missing event/command, and any entry with
// extra/duplicate fields is skipped with console.warn — config errors must
// never crash the extension (fail-open).
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

export interface HookRule {
  event: string;
  command: string;
  /** Compiled matcher regex; undefined = match everything. */
  matcher?: RegExp;
  /** Raw matcher source (kept for diagnostics/tests). */
  matcherSource?: string;
  /** Timeout in seconds (1-600, default 30). */
  timeout: number;
}

const HOOK_FIELDS = new Set(["event", "matcher", "command", "timeout"]);
const INVALID = "__hooks_invalid";

// ------------------------------------------------------------
// Minimal TOML parsing helpers
// ------------------------------------------------------------

/** Strip a trailing `#` comment, honoring quoted strings (basic + literal). */
function stripComment(line: string): string {
  let quote: string | null = null;
  let esc = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (esc) { esc = false; continue; }
    if (c === "\\" && quote === '"') { esc = true; continue; }
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "#") return line.slice(0, i);
  }
  return line;
}

/**
 * Parse a TOML string value:
 *   - basic string `"..."` with \" \\ \n \t \r escapes
 *   - literal string `'...'` (raw, no escapes — real-world hook configs use
 *     these for Windows paths, e.g. command = '"C:\...\node.exe" "..."')
 * Returns null when the value is not a well-formed quoted string.
 */
export function parseTomlString(raw: string): string | null {
  const v = raw.trim();
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    if (end < 0) return null;
    return v.slice(end + 1).trim() === "" ? v.slice(1, end) : null;
  }
  if (!v.startsWith('"')) return null;
  let out = "";
  for (let i = 1; i < v.length; i++) {
    const c = v[i];
    if (c === "\\") {
      const n = v[i + 1];
      if (n === '"') { out += '"'; i++; }
      else if (n === "\\") { out += "\\"; i++; }
      else if (n === "n") { out += "\n"; i++; }
      else if (n === "t") { out += "\t"; i++; }
      else if (n === "r") { out += "\r"; i++; }
      else return null; // unsupported escape
      continue;
    }
    if (c === '"') {
      // Closing quote — only trailing whitespace may follow.
      return v.slice(i + 1).trim() === "" ? out : null;
    }
    out += c;
  }
  return null; // unterminated string
}

/**
 * Parse config.toml content into hook rules.
 * Bad entries are skipped with console.warn (fail-open), never thrown.
 */
export function parseHooksToml(content: string): HookRule[] {
  const entries: Array<Record<string, unknown>> = [];
  let current: Record<string, unknown> | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    // Array-of-tables header
    const arrMatch = line.match(/^\[\[\s*([^\]]+?)\s*\]\]$/);
    if (arrMatch) {
      if (arrMatch[1] === "hooks") {
        current = {};
        entries.push(current);
      } else {
        current = null; // other arrays are ignored
      }
      continue;
    }
    // Plain table header — ends any [[hooks]] entry context
    if (/^\[\s*[^\]]+?\s*\]$/.test(line)) {
      current = null;
      continue;
    }
    // key = value
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kv) {
      if (!current) continue; // key outside [[hooks]] — not our concern
      const key = kv[1];
      const rawVal = kv[2].trim();
      if (!HOOK_FIELDS.has(key) || current[key] !== undefined) {
        console.warn(`[hooks] config: ${current[key] !== undefined ? "duplicate" : "unknown"} field "${key}" in [[hooks]] entry — entry skipped`);
        current[INVALID] = true;
        continue;
      }
      if (key === "timeout") {
        if (/^-?\d+$/.test(rawVal)) {
          current.timeout = parseInt(rawVal, 10);
        } else {
          console.warn(`[hooks] config: timeout must be an integer (got ${rawVal}) — entry skipped`);
          current[INVALID] = true;
        }
      } else {
        const s = parseTomlString(rawVal);
        if (s === null) {
          console.warn(`[hooks] config: unparseable value for "${key}": ${rawVal.slice(0, 60)} — entry skipped`);
          current[INVALID] = true;
        } else {
          current[key] = s;
        }
      }
      continue;
    }
    // Anything else is unparseable — warn, poison the current entry if any.
    console.warn(`[hooks] config: unparseable line skipped: ${line.slice(0, 80)}`);
    if (current) current[INVALID] = true;
  }

  const rules: HookRule[] = [];
  for (const e of entries) {
    if (e[INVALID]) continue;
    if (typeof e.event !== "string" || !e.event || typeof e.command !== "string" || !e.command) {
      console.warn(`[hooks] config: [[hooks]] entry missing required event/command — entry skipped`);
      continue;
    }
    let timeout = 30;
    if (e.timeout !== undefined) {
      const t = e.timeout as number;
      if (!Number.isInteger(t) || t < 1 || t > 600) {
        console.warn(`[hooks] config: timeout must be 1-600 seconds (got ${t}) — entry skipped`);
        continue;
      }
      timeout = t;
    }
    let matcher: RegExp | undefined;
    let matcherSource: string | undefined;
    if (typeof e.matcher === "string" && e.matcher) {
      try {
        matcher = new RegExp(e.matcher);
        matcherSource = e.matcher;
      } catch {
        console.warn(`[hooks] config: invalid matcher regex "${e.matcher}" — entry skipped`);
        continue;
      }
    }
    rules.push({ event: e.event as string, command: e.command as string, matcher, matcherSource, timeout });
  }
  return rules;
}

// ------------------------------------------------------------
// Two-layer loading with per-file mtime cache
// ------------------------------------------------------------

interface HookFileCache {
  mtimeMs: number; // -1 = file missing
  rules: HookRule[];
}
const hookFileCache = new Map<string, HookFileCache>();

/** Load one config.toml with mtime caching: at most one statSync per call. */
function loadHookFile(configPath: string): HookRule[] {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch { /* missing or unreadable → treated as absent */ }
  const cached = hookFileCache.get(configPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached.rules;
  let rules: HookRule[] = [];
  if (mtimeMs >= 0) {
    try {
      rules = parseHooksToml(fs.readFileSync(configPath, "utf-8"));
    } catch (e: any) {
      console.warn(`[hooks] failed to read ${configPath}: ${e?.message || e}`);
    }
  }
  hookFileCache.set(configPath, { mtimeMs, rules });
  return rules;
}

/** Walk up from cwd for the nearest .kimi-code/config.toml. */
function findProjectConfig(cwd: string): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, ".kimi-code", "config.toml");
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch { /* keep walking */ }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function globalConfigPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  const kimiHome = process.env.KIMI_CODE_HOME || path.join(home, ".kimi-code");
  return path.join(kimiHome, "config.toml");
}

/**
 * Merged hook rules for a working directory: project layer first, global
 * layer second. Missing layers contribute nothing. Never throws.
 *
 * `opts.projectConfig`: test/advanced override — an explicit project-layer
 * config path, or null to skip the project walk entirely (isolation).
 */
export function getHookRules(cwd: string, opts?: { projectConfig?: string | null }): HookRule[] {
  // Single-file override (tests / kill-switch): when KIMI_CODE_HOOKS_CONFIG
  // is set it is the only config source — project walk and global layer are
  // skipped entirely.
  const override = process.env.KIMI_CODE_HOOKS_CONFIG;
  if (override) return loadHookFile(override);

  const rules: HookRule[] = [];
  const seen = new Set<string>();
  const projectPath = opts?.projectConfig !== undefined
    ? opts.projectConfig
    : findProjectConfig(cwd);
  if (projectPath && !seen.has(projectPath)) {
    seen.add(projectPath);
    rules.push(...loadHookFile(projectPath));
  }
  const globalPath = globalConfigPath();
  if (!seen.has(globalPath)) {
    rules.push(...loadHookFile(globalPath));
  }
  return rules;
}

/** Cheap probe: does any layer define at least one rule? (early-exit gate) */
export function hasAnyHookRules(cwd: string): boolean {
  try {
    return getHookRules(cwd).length > 0;
  } catch {
    return false;
  }
}

/** Test hook: clear the mtime cache. */
export function resetHookConfigCache(): void {
  hookFileCache.clear();
}
