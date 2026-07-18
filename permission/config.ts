// ============================================================
// Permission Config — Read user deny/ask/allow rules
// ============================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { UserPermissionConfig, ToolPattern } from './types';

function parsePattern(raw: string): ToolPattern {
  // Format: "toolName" or "toolName:path/pattern" or "path/pattern"
  const colonIdx = raw.indexOf(':');
  if (colonIdx > 0) {
    const toolName = raw.substring(0, colonIdx).trim();
    const pathPattern = raw.substring(colonIdx + 1).trim();
    return { raw, toolName, pathPattern: new RegExp(pathPattern, 'i') };
  }
  // Check if it's a tool name or path
  if (/^(read|write|edit|bash|grep|find|ls)$/.test(raw)) {
    return { raw, toolName: raw };
  }
  return { raw, pathPattern: new RegExp(raw, 'i') };
}

// Per-file mtime cache: permission evaluation is a security hot path that
// re-reads these files on every tool call. mtime change forces an immediate
// re-read, so rule edits take effect on the very next evaluate; an unchanged
// mtime skips both readFileSync and RegExp recompilation.
interface ConfigFileCache {
  mtimeMs: number; // -1 = file missing
  deny: ToolPattern[];
  ask: ToolPattern[];
  allow: ToolPattern[];
}
const configFileCache = new Map<string, ConfigFileCache>();

function loadConfigFile(configPath: string): ConfigFileCache {
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(configPath).mtimeMs;
  } catch { /* missing or unreadable → treated as absent */ }
  const cached = configFileCache.get(configPath);
  if (cached && cached.mtimeMs === mtimeMs) return cached;
  const entry: ConfigFileCache = { mtimeMs, deny: [], ask: [], allow: [] };
  if (mtimeMs >= 0) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (parsed.deny) entry.deny = (parsed.deny as string[]).map(parsePattern);
      if (parsed.ask) entry.ask = (parsed.ask as string[]).map(parsePattern);
      if (parsed.allow) entry.allow = (parsed.allow as string[]).map(parsePattern);
    } catch { /* ignore */ }
  }
  configFileCache.set(configPath, entry);
  return entry;
}

export function loadUserConfig(cwd: string): UserPermissionConfig {
  const config: UserPermissionConfig = {
    deny: [],
    ask: [],
    allow: [],
  };

  // Load from ~/.pi/agent/permissions.json
  const globalConfig = path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.pi', 'agent', 'permissions.json'
  );

  // Load from .pi/permissions.json (project-level)
  const projectConfig = path.join(cwd, '.pi', 'permissions.json');

  for (const configPath of [globalConfig, projectConfig]) {
    const file = loadConfigFile(configPath);
    config.deny.push(...file.deny);
    config.ask.push(...file.ask);
    config.allow.push(...file.allow);
  }

  return config;
}

/**
 * Walk up from `cwd` looking for the nearest AGENTS.md.
 * Returns the file path, or null if none found.
 */
export function findAgentsMd(cwd: string): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, 'AGENTS.md');
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch { /* ignore */ }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Minimal AGENTS.md directive parser.
 * Supports:
 *   - `# @keyword value` lines
 *   - `## Section` headers (key = section slug, value = empty)
 * Returns a key-value record; values are lower-cased and trimmed.
 */
export function parseAgentsMd(content: string): Record<string, string> {
  const directives: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    // '# @keyword value'
    const atMatch = line.match(/^#\s*@(\S+)\s*(.*)$/);
    if (atMatch) {
      directives[atMatch[1].toLowerCase()] = atMatch[2].trim().toLowerCase();
      continue;
    }
    // '## Section Name' -> section:section-name
    const sectionMatch = line.match(/^#{2,}\s+(.+)$/);
    if (sectionMatch) {
      const slug = sectionMatch[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      if (slug) directives[`section:${slug}`] = '';
    }
  }
  return directives;
}

/**
 * Load the nearest AGENTS.md raw contents.
 * Safe to call even when no file exists.
 */
export function loadAgentsMd(cwd: string): string | undefined {
  const filePath = findAgentsMd(cwd);
  if (!filePath) return undefined;
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

export function matchesPattern(
  pattern: ToolPattern,
  toolName: string,
  input: Record<string, unknown>,
  cwd: string
): boolean {
  // Check tool name
  if (pattern.toolName && pattern.toolName !== toolName) return false;
  
  // Check path pattern
  if (pattern.pathPattern) {
    const filePath = (input.path as string) || (input.file_path as string) || '';
    if (!filePath) return false;
    const resolved = path.resolve(cwd, filePath);
    if (!pattern.pathPattern.test(resolved) && !pattern.pathPattern.test(filePath)) {
      return false;
    }
  }
  
  // If neither toolName nor pathPattern, match all
  if (!pattern.toolName && !pattern.pathPattern) return true;
  
  return true;
}
