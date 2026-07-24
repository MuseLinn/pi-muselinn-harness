// ============================================================
// Agent File Catalog — Main Service
// ============================================================
// Singleton service that discovers, caches, and provides agent
// profiles to the rest of the harness.

import { collectRoots, findProjectRoot, systemMdPath } from "./roots.ts";
import { discoverAgentFiles } from "./discovery.ts";
import { parseSystemMd } from "./parse.ts";
import type { AgentFileDef, AgentProfile, AgentFileRoot } from "./types.ts";

/** Convert an AgentFileDef to an AgentProfile (expand system prompt). */
function defToProfile(def: AgentFileDef, basePrompt: string): AgentProfile {
  let systemPrompt = def.prompt;
  if (systemPrompt.includes("${base_prompt}") && basePrompt) {
    systemPrompt = systemPrompt.replace(/\$\{base_prompt\}/g, basePrompt);
  }
  return {
    name: def.name,
    description: def.description,
    whenToUse: def.whenToUse,
    tools: def.tools,
    disallowedTools: def.disallowedTools,
    subagents: def.subagents,
    systemPrompt,
    sourcePath: def.path,
    source: def.source,
  };
}

export class AgentFileService {
  private rawDefs: AgentFileDef[] = [];
  private profiles: AgentProfile[] = [];
  private systemMdProfile: AgentProfile | null = null;
  private basePrompt = "";

  /**
   * Discover agent files and build profiles.
   * Call on session_start to populate the cache.
   */
  discover(cwd: string): { profiles: AgentProfile[]; errors: string[] } {
    const projectRoot = findProjectRoot(cwd);
    const roots = collectRoots(projectRoot);

    const result = discoverAgentFiles(roots);
    const errors = [...result.errors];

    // Store raw defs for re-derivation
    this.rawDefs = result.agents;

    // Try SYSTEM.md override
    this.systemMdProfile = null;
    const sysMd = systemMdPath();
    if (sysMd) {
      const parsed = parseSystemMd(sysMd);
      if (parsed) {
        this.systemMdProfile = {
          name: "__default__",
          description: parsed.description,
          systemPrompt: parsed.prompt,
          isDefault: true,
          sourcePath: sysMd,
          source: "user",
        };
      }
    }

    // Build profiles with current base prompt
    this.profiles = this.rawDefs.map((def) => defToProfile(def, this.basePrompt));

    return { profiles: this.profiles, errors };
  }

  /** Get the default system prompt (SYSTEM.md override or null). */
  getDefaultProfile(): AgentProfile | null {
    return this.systemMdProfile;
  }

  /** Get a specific profile by name. */
  getProfile(name: string): AgentProfile | undefined {
    return this.profiles.find((p) => p.name === name);
  }

  /** Get all discovered profiles. */
  getAllProfiles(): AgentProfile[] {
    return this.profiles;
  }

  /** Set the base prompt and re-derive profiles. */
  setBasePrompt(prompt: string): void {
    this.basePrompt = prompt;
    // Re-derive all profiles with the new base prompt
    this.profiles = this.rawDefs.map((def) => defToProfile(def, this.basePrompt));
  }

  /** Clear the cache (next discover re-scans all roots). */
  refresh(): void {
    this.rawDefs = [];
    this.profiles = [];
    this.systemMdProfile = null;
  }
}

export { findProjectRoot } from "./roots.ts";

/** Singleton instance. */
export const agentFileService = new AgentFileService();
