// ============================================================
// Tool Policy — Three-Layer Evaluation Engine
// ============================================================
// Evaluates whether a tool is active given a set of policy
// layers. Layer precedence: profile.allow → profile.deny →
// session.disabled.
//
// Matching rules:
//   - Built-in tools: exact name match
//   - Glob patterns: "*" wildcard only (mcp__* matches all MCP)
//   - undefined = no restriction
//   - empty array = restrict all

import type { ToolActivationPolicy, ToolPolicyLayers } from "./types.ts";

/** Simple glob match: supports "*" wildcard (zero-or-more chars). */
function globMatch(pattern: string, name: string): boolean {
  if (pattern === "*") return true;
  if (!pattern.includes("*")) return pattern === name;
  // Simple glob: split on * and check each segment
  const parts = pattern.split("*");
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const idx = name.indexOf(part, pos);
    if (idx < 0) return false;
    pos = idx + part.length;
  }
  return true;
}

/** Check if a name matches any pattern in a list. */
function matchesAny(patterns: string[] | undefined, name: string): boolean {
  if (!patterns) return false;
  for (const p of patterns) {
    if (globMatch(p, name)) return true;
  }
  return false;
}

/**
 * Evaluate whether a tool is active under a single activation policy.
 *
 * Returns true (active) or false (inactive/blocked).
 * Rules:
 *   1. tools list exists AND name not in it → false (allow-list rejects)
 *   2. disallowedTools exists AND name in it → false (deny-list rejects)
 *   3. otherwise → true
 */
export function isToolActive(
  name: string,
  policy: ToolActivationPolicy,
): boolean {
  // Allow-list: if defined and name not matched, block
  if (policy.tools !== undefined && !matchesAny(policy.tools, name)) {
    return false;
  }
  // Deny-list: if defined and name matched, block
  if (matchesAny(policy.disallowedTools, name)) {
    return false;
  }
  return true;
}

/**
 * Evaluate tool across all layers.
 * Layer order: profile → session disabled.
 * Any layer blocking → false.
 */
export function isToolActiveComposed(
  name: string,
  layers: ToolPolicyLayers,
): boolean {
  // 1. Profile layer
  if (!isToolActive(name, layers.profile)) return false;
  // 2. Session disabled
  if (matchesAny(layers.sessionDisabled, name)) return false;
  return true;
}

/**
 * Given a policy, resolve the effective active tool name set.
 * Returns undefined when all tools are allowed (no restriction).
 */
export function resolveActiveToolNames(
  policy: ToolActivationPolicy,
): string[] | undefined {
  if (policy.tools === undefined && policy.disallowedTools === undefined) {
    return undefined; // no restriction
  }
  return policy.tools; // only meaningful when defined
}

/**
 * Validate tool patterns: detect patterns that can never match.
 * Returns a list of invalid patterns with reasons.
 */
export function findInvalidToolPatterns(
  patterns: string[],
  isKnownTool: (name: string) => boolean,
): Array<{ pattern: string; reason: string }> {
  const invalid: Array<{ pattern: string; reason: string }> = [];
  for (const p of patterns) {
    // Glob patterns are valid for MCP tools
    if (p.includes("*")) {
      if (p.startsWith("mcp__")) continue; // mcp__server__* is valid
      // Non-MCP glob: warn
      invalid.push({ pattern: p, reason: "wildcard-not-mcp: glob patterns only match MCP tools" });
      continue;
    }
    // Exact name: check if known
    if (!isKnownTool(p)) {
      invalid.push({ pattern: p, reason: "unknown-tool: no registered tool with this name" });
    }
  }
  return invalid;
}
