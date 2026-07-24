// ============================================================
// Tool Policy — Main Service
// ============================================================
// Singleton service that manages the three-layer tool gating
// and provides isActive checks for the permission system.

import type { ToolActivationPolicy, ToolPolicyLayers } from "./types.ts";
import { isToolActiveComposed, findInvalidToolPatterns } from "./evaluate.ts";

/** Default known tool set for validation (harness core tools). */
const KNOWN_TOOLS = new Set([
  "read", "grep", "glob", "write", "edit", "bash",
  "agent", "agent_swarm",
  "ask_user_question",
  "todo_list", "create_goal", "get_goal", "set_goal_budget", "update_goal",
  "task_list", "task_output", "task_stop",
  "cron_create", "cron_delete", "cron_list",
  "web_search", "fetch_content",
  "agent_file_list", "agent_file_info",
  "enter_plan_mode", "exit_plan_mode",
]);

export class ToolPolicyService {
  private profilePolicy: ToolActivationPolicy = {};
  private sessionDisabled: string[] = [];
  private knownTools: Set<string>;

  constructor(knownTools?: Set<string>) {
    this.knownTools = knownTools ?? KNOWN_TOOLS;
  }

  /** Set profile-level tool policy (from agent file or built-in profile). */
  setProfilePolicy(policy: ToolActivationPolicy): void {
    this.profilePolicy = { ...policy };
  }

  /** Reset profile policy to unrestricted. */
  clearProfilePolicy(): void {
    this.profilePolicy = {};
  }

  /** Set session-level disabled tools (runtime override). */
  setSessionDisabled(names: string[]): void {
    this.sessionDisabled = [...names];
  }

  /** Clear session disabled tools. */
  clearSessionDisabled(): void {
    this.sessionDisabled = [];
  }

  /** Check if a tool is active under the current policy. */
  isActive(name: string): boolean {
    return isToolActiveComposed(name, {
      profile: this.profilePolicy,
      sessionDisabled: this.sessionDisabled,
    });
  }

  /** Get the full effective policy (for diagnostics). */
  getEffectivePolicy(): ToolPolicyLayers {
    return {
      profile: { ...this.profilePolicy },
      sessionDisabled: [...this.sessionDisabled],
    };
  }

  /** Validate tool patterns against known tools. */
  validatePatterns(patterns: string[]): Array<{ pattern: string; reason: string }> {
    return findInvalidToolPatterns(patterns, (name) => this.knownTools.has(name));
  }

  /** Reset all policy state. */
  reset(): void {
    this.profilePolicy = {};
    this.sessionDisabled = [];
  }
}

/** Singleton instance */
export const toolPolicyService = new ToolPolicyService();
