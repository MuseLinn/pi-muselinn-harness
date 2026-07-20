// ============================================================
// Plugin manifest — declarative resource bundle (pure).
//
// Kimi plugin parity (app/plugin/types.ts): a plugin is NOT a code
// extension — it is a bundle of six declarative capabilities:
// skills, sessionStart, mcpServers, hooks, commands, interface.
// This module parses and validates the manifest; the adapter applies
// it. mcpServers and interface are recorded with diagnostics (this
// host does not consume them yet) rather than silently ignored.
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

export const PLUGIN_MANIFEST_NAME = "muselinn.plugin.json";

export interface PluginHookRule {
  event: string;
  command: string;
  matcher?: string;
  timeout?: number;
}

export interface PluginManifest {
  name: string;
  version?: string;
  description?: string;
  /** Dirs (relative to the plugin dir) containing SKILL.md trees. */
  skills: string[];
  /** Text injected as context on the session's first turn. */
  sessionStart: string[];
  /** Recorded + diagnostic (not consumed by this host). */
  mcpServers: Record<string, unknown>;
  hooks: PluginHookRule[];
  /** name → .md file (relative to the plugin dir), expanded as a slash command. */
  commands: Record<string, string>;
  /** Recorded + diagnostic (not consumed by this host). */
  interface: Record<string, unknown>;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  diagnostics: string[];
}

/**
 * Parse + validate a manifest object. Unknown shapes degrade to
 * diagnostics, never throws. Relative paths are resolved against the
 * plugin dir; missing skill dirs / command files are diagnostics.
 */
export function parsePluginManifest(raw: any, pluginDir: string): LoadedPlugin {
  const diagnostics: string[] = [];
  const m: PluginManifest = {
    name: typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim() : path.basename(pluginDir),
    version: typeof raw?.version === "string" ? raw.version : undefined,
    description: typeof raw?.description === "string" ? raw.description : undefined,
    skills: [],
    sessionStart: [],
    mcpServers: {},
    hooks: [],
    commands: {},
    interface: {},
  };
  if (!raw || typeof raw !== "object") {
    diagnostics.push("manifest is not an object");
    return { manifest: m, dir: pluginDir, diagnostics };
  }

  // skills
  const rawSkills = Array.isArray(raw.skills) ? raw.skills : raw.skills ? [raw.skills] : [];
  for (const s of rawSkills) {
    if (typeof s !== "string" || !s.trim()) continue;
    const abs = path.resolve(pluginDir, s.trim());
    if (fs.existsSync(abs)) m.skills.push(abs);
    else diagnostics.push(`skills dir not found: ${s}`);
  }

  // sessionStart
  const ss = raw.sessionStart;
  if (typeof ss === "string" && ss.trim()) m.sessionStart.push(ss);
  else if (Array.isArray(ss)) {
    for (const t of ss) if (typeof t === "string" && t.trim()) m.sessionStart.push(t);
  }

  // mcpServers / interface — recorded only
  if (raw.mcpServers && typeof raw.mcpServers === "object") {
    m.mcpServers = raw.mcpServers;
    diagnostics.push(`mcpServers declared (${Object.keys(raw.mcpServers).length}) — not consumed by this host, skipped`);
  }
  if (raw.interface && typeof raw.interface === "object") {
    m.interface = raw.interface;
    diagnostics.push("interface declared — not consumed by this host, skipped");
  }

  // hooks
  const rawHooks = Array.isArray(raw.hooks) ? raw.hooks : [];
  for (const h of rawHooks) {
    if (!h || typeof h.event !== "string" || typeof h.command !== "string") {
      diagnostics.push("hook entry missing event/command, skipped");
      continue;
    }
    if (h.matcher !== undefined && typeof h.matcher !== "string") {
      diagnostics.push(`hook ${h.event}: matcher must be a string, skipped`);
      continue;
    }
    m.hooks.push({
      event: h.event,
      command: h.command,
      matcher: h.matcher,
      timeout: typeof h.timeout === "number" ? h.timeout : undefined,
    });
  }

  // commands
  const rawCmds = raw.commands && typeof raw.commands === "object" ? raw.commands : {};
  for (const [name, file] of Object.entries(rawCmds)) {
    if (!/^[a-z0-9][a-z0-9-_]*$/i.test(name)) {
      diagnostics.push(`invalid command name "${name}", skipped`);
      continue;
    }
    if (typeof file !== "string") {
      diagnostics.push(`command "${name}": file must be a string, skipped`);
      continue;
    }
    const abs = path.resolve(pluginDir, file);
    if (fs.existsSync(abs)) m.commands[name] = abs;
    else diagnostics.push(`command "${name}" file not found: ${file}`);
  }

  return { manifest: m, dir: pluginDir, diagnostics };
}

/**
 * Discover plugins under the given root dirs: every immediate child dir
 * containing a manifest file is a plugin. Later roots lose name
 * collisions to earlier ones (first-wins, pi's dedupe convention).
 */
export function discoverPlugins(rootDirs: string[]): LoadedPlugin[] {
  const out: LoadedPlugin[] = [];
  const seen = new Set<string>();
  for (const root of rootDirs) {
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue; // root missing — fine
    }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const dir = path.join(root, child.name);
      const manifestPath = path.join(dir, PLUGIN_MANIFEST_NAME);
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const loaded = parsePluginManifest(raw, dir);
        if (seen.has(loaded.manifest.name)) {
          loaded.diagnostics.push(`duplicate plugin name "${loaded.manifest.name}" — earlier root wins, skipped`);
          continue;
        }
        seen.add(loaded.manifest.name);
        out.push(loaded);
      } catch (e: any) {
        out.push({
          manifest: { name: child.name, skills: [], sessionStart: [], mcpServers: {}, hooks: [], commands: {}, interface: {} },
          dir,
          diagnostics: [`manifest parse error: ${e?.message ?? String(e)}`],
        });
      }
    }
  }
  return out;
}

/** Default plugin roots (user scope then project scope). */
export function defaultPluginRoots(home: string, projectRoot: string): string[] {
  return [
    path.join(projectRoot, ".pi", "plugins"),
    path.join(home, ".pi", "agent", "plugins"),
  ];
}
