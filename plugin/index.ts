// ============================================================
// Plugin loader (adapter) — declarative resource bundles.
//
// Loads muselinn.plugin.json bundles from project (.pi/plugins) and
// user (~/.pi/agent/plugins) roots, and applies five of the six
// capabilities (mcpServers / interface are recorded with diagnostics):
//   skills       → merged into resources_discover results
//   sessionStart → injected as context on the session's first turn
//   hooks        → merged into the hook engine (addExtraHookRules)
//   commands     → registered as slash commands expanding their .md file
//   mcp/interface→ diagnostics only (this host does not consume them)
// ============================================================

import * as fs from "node:fs";
import * as path from "node:path";

import { discoverPlugins, defaultPluginRoots, type LoadedPlugin } from "../packages/core/plugin/manifest";
import { addExtraHookRules, type HookRule } from "../packages/core/hooks/config";
import { findProjectRoot } from "../packages/core/skills/scanner";

interface PluginRuntime {
  loaded: LoadedPlugin[];
  skillFiles: string[];
  sessionStartTexts: string[];
  diagnostics: string[];
}

const rt: PluginRuntime = {
  loaded: [],
  skillFiles: [],
  sessionStartTexts: [],
  diagnostics: [],
};

/** SKILL.md files contributed by plugins (merged into resources_discover). */
export function getPluginSkillFiles(): string[] {
  return rt.skillFiles;
}

function collectSkillFiles(skillDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile() && e.name.toLowerCase() === "skill.md") out.push(p);
    }
  };
  walk(skillDir, 0);
  return out;
}

function toHookRules(plugin: LoadedPlugin): HookRule[] {
  const rules: HookRule[] = [];
  for (const h of plugin.manifest.hooks) {
    let matcher: RegExp | undefined;
    if (h.matcher) {
      try {
        matcher = new RegExp(h.matcher, "i");
      } catch {
        rt.diagnostics.push(`${plugin.manifest.name}: hook ${h.event} bad matcher /${h.matcher}/, skipped`);
        continue;
      }
    }
    // Relative hook commands resolve against the plugin dir.
    const command = h.command.startsWith(".")
      ? path.resolve(plugin.dir, h.command)
      : h.command;
    rules.push({
      event: h.event,
      command,
      matcher,
      matcherSource: h.matcher,
      timeout: typeof h.timeout === "number" ? Math.max(1, Math.min(600, h.timeout)) : 30,
    });
  }
  return rules;
}

/** Discover + apply all plugins. Called once at extension startup. */
export function loadPlugins(pi: any, ctx: any): void {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  let projectRoot = process.cwd();
  try { projectRoot = findProjectRoot(ctx?.cwd || process.cwd()); } catch { /* ok */ }

  rt.loaded = discoverPlugins(defaultPluginRoots(home, projectRoot));

  for (const plugin of rt.loaded) {
    const name = plugin.manifest.name;
    rt.diagnostics.push(...plugin.diagnostics.map((d) => `${name}: ${d}`));

    // skills
    for (const dir of plugin.manifest.skills) {
      rt.skillFiles.push(...collectSkillFiles(dir));
    }

    // sessionStart
    rt.sessionStartTexts.push(...plugin.manifest.sessionStart);

    // hooks
    const rules = toHookRules(plugin);
    if (rules.length > 0) addExtraHookRules(rules);

    // commands → slash commands expanding the .md file
    for (const [cmdName, file] of Object.entries(plugin.manifest.commands)) {
      try {
        const content = fs.readFileSync(file, "utf8").trim();
        if (!content) {
          rt.diagnostics.push(`${name}: command "${cmdName}" is empty, skipped`);
          continue;
        }
        pi.registerCommand(cmdName, {
          description: `(plugin: ${name}) ${content.split("\n")[0].slice(0, 80)}`,
          handler: async () => {
            pi.sendUserMessage(content);
          },
        });
      } catch (e: any) {
        rt.diagnostics.push(`${name}: command "${cmdName}" failed to register: ${e?.message ?? String(e)}`);
      }
    }
  }

  // One consolidated notice when anything noteworthy happened.
  if (rt.loaded.length > 0 && ctx?.hasUI) {
    const diagNote = rt.diagnostics.length > 0 ? ` · ${rt.diagnostics.length} diagnostics` : "";
    try {
      ctx.ui.notify(`plugins: ${rt.loaded.map((p) => p.manifest.name).join(", ")} loaded${diagNote} (/plugins)`, "info");
    } catch { /* ok */ }
  }
}

/** Inject queued sessionStart texts as first-turn context. */
export function injectPluginSessionStart(pi: any): void {
  if (rt.sessionStartTexts.length === 0) return;
  const text = rt.sessionStartTexts.join("\n\n");
  try {
    pi.sendMessage(
      { customType: "muselinn_plugin_session_start", content: text, display: false },
      { deliverAs: "nextTurn" },
    );
  } catch {
    // Older pi without sendMessage: fall back to a user_prompt_submit transform.
    try {
      pi.on("user_prompt_submit", (event: any) => {
        if (!event?.text) return undefined;
        return { action: "transform", text: `${event.text}\n\n${text}` };
      });
    } catch { /* give up silently */ }
  }
}

// ── /plugins command ──────────────────────────────────────────

export function registerPluginCommand(pi: any): void {
  pi.registerCommand("plugins", {
    description: "List loaded plugins and their capabilities",
    handler: async (_args: string, ctx: any) => {
      if (rt.loaded.length === 0) {
        ctx.ui.notify("No plugins found (.pi/plugins or ~/.pi/agent/plugins with muselinn.plugin.json)", "info");
        return;
      }
      const lines: string[] = [];
      for (const p of rt.loaded) {
        const m = p.manifest;
        const caps: string[] = [];
        if (m.skills.length > 0) caps.push(`${m.skills.length} skill dirs`);
        if (m.sessionStart.length > 0) caps.push("sessionStart");
        if (m.hooks.length > 0) caps.push(`${m.hooks.length} hooks`);
        if (Object.keys(m.commands).length > 0) caps.push(`${Object.keys(m.commands).length} commands`);
        if (Object.keys(m.mcpServers).length > 0) caps.push("mcp(skipped)");
        if (Object.keys(m.interface).length > 0) caps.push("interface(skipped)");
        lines.push(`${m.name}${m.version ? `@${m.version}` : ""} — ${caps.join(", ") || "no capabilities"}${m.description ? ` — ${m.description}` : ""}`);
      }
      if (rt.diagnostics.length > 0) {
        lines.push("", "diagnostics:", ...rt.diagnostics.map((d) => `  · ${d}`));
      }
      ctx.ui.notify(lines.join("\n"), "info");
    },
  });
}
