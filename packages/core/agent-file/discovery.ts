// ============================================================
// Agent File Catalog — Discovery
// ============================================================
// Walk agent file roots, discover all *.md files, parse them,
// deduplicate by name.

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentFileDef, AgentFileRoot, AgentFileDiscoveryResult, SkippedAgentFile } from "./types.ts";
import { parseAgentFile } from "./parse.ts";

/** Maximum recursion depth for agent file scanning. */
const MAX_DEPTH = 8;

/** Maximum number of skipped-file warnings to report. */
const MAX_SKIPPED_WARNINGS = 5;

/**
 * Scan a single root directory for agent files (recursive, max depth 8).
 * Only scans *.md files; skips dot-prefixed entries and node_modules.
 */
function scanDir(
  rootDir: string,
  source: "project" | "user",
  skipped: SkippedAgentFile[],
  depth = 0,
): AgentFileDef[] {
  if (depth > MAX_DEPTH) return [];

  let entries: string[];
  try {
    entries = fs.readdirSync(rootDir);
  } catch {
    // EACCES, ENOENT, etc.
    return [];
  }

  const agents: AgentFileDef[] = [];

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    if (entry === "node_modules") continue;

    const fullPath = path.join(rootDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      agents.push(...scanDir(fullPath, source, skipped, depth + 1));
    } else if (stat.isFile() && entry.endsWith(".md")) {
      const agent = parseAgentFile(fullPath, source);
      if (agent) {
        agents.push(agent);
      } else if (skipped.length < MAX_SKIPPED_WARNINGS) {
        skipped.push({ path: fullPath, reason: "Invalid or missing required fields" });
      }
    }
  }

  return agents;
}

/**
 * Discover all agent files from the given roots.
 * Deduplicates by name: earliest root wins.
 * Errors are collected per root and reported.
 */
export function discoverAgentFiles(roots: AgentFileRoot[]): AgentFileDiscoveryResult {
  const agents: AgentFileDef[] = [];
  const errors: string[] = [];
  const scannedRoots: string[] = [];
  const seen = new Set<string>();
  const skipped: SkippedAgentFile[] = [];

  for (const root of roots) {
    scannedRoots.push(root.dir);
    try {
      const found = scanDir(root.dir, root.source, skipped);
      for (const agent of found) {
        if (!seen.has(agent.name)) {
          seen.add(agent.name);
          agents.push(agent);
        }
      }
    } catch (e: any) {
      errors.push(`[${root.source}] ${root.dir}: ${e.message || e}`);
    }
  }

  return { agents, errors, scannedRoots };
}
