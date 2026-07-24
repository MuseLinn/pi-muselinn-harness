// ============================================================
// Agent File Catalog — Search Root Discovery
// ============================================================
// Three scopes (user < project), each with pi-native and
// kimi-code compat directories.
//
// Project scope (scoped to project root):
//   {projectRoot}/.pi/agents/
//   {projectRoot}/.kimi-code/agents/
//   {projectRoot}/.agents/agents/
//
// User scope (always included):
//   {agentDir}/agents/            (~/.pi/agent/agents/)
//   {kimiCodeHome}/agents/        (~/.kimi-code/agents/, via KIMI_CODE_HOME)
//   ~/.agents/agents/
//
// SYSTEM.md:
//   {agentDir}/SYSTEM.md          (~/.pi/agent/SYSTEM.md)

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AgentFileRoot, AgentFileSource } from "./types.ts";

/** Locate the project root by walking up for .git / .hg / .pi root marker. */
export function findProjectRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  const root = path.parse(dir).root;
  while (dir !== root) {
    try {
      if (
        fs.statSync(path.join(dir, ".git")).isDirectory() ||
        fs.statSync(path.join(dir, ".hg")).isDirectory()
      ) {
        return dir;
      }
    } catch {
      // not found, keep walking up
    }
    // Also check for .pi marker (some projects use .pi as root marker)
    try {
      if (fs.statSync(path.join(dir, ".pi")).isDirectory()) {
        // .pi is a directory — only treat as project root if it has a config
        try {
          if (fs.statSync(path.join(dir, ".pi", "config.toml")).isFile()) return dir;
        } catch { /* not the root */ }
      }
    } catch { /* not found */ }
    dir = path.dirname(dir);
  }
  // Final check at the root itself (unlikely but safe)
  try {
    if (fs.statSync(path.join(dir, ".git")).isDirectory()) return dir;
  } catch { /* not found */ }
  return null;
}

/** Resolve KIMI_CODE_HOME (default ~/.kimi-code). */
export function kimiCodeHome(): string {
  return process.env.KIMI_CODE_HOME || path.join(os.homedir(), ".kimi-code");
}

/** Resolve pi agent dir (KIMI_AGENT_DIR or default ~/.pi/agent). */
export function agentDir(): string {
  return process.env.KIMI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

/**
 * Get project-scope agent file roots.
 * Returns directories that actually exist (non-existent are filtered out).
 */
export function projectRoots(projectRoot: string): AgentFileRoot[] {
  const dirs: AgentFileRoot[] = [];
  const candidates = [
    path.join(projectRoot, ".pi", "agents"),
    path.join(projectRoot, ".kimi-code", "agents"),
    path.join(projectRoot, ".agents", "agents"),
  ];
  for (const d of candidates) {
    try {
      if (fs.statSync(d).isDirectory()) {
        dirs.push({ dir: d, source: "project" });
      }
    } catch {
      // non-existent or inaccessible — skip
    }
  }
  return dirs;
}

/**
 * Get user-scope agent file roots.
 * Returns directories that actually exist (non-existent are filtered out).
 */
export function userRoots(): AgentFileRoot[] {
  const dirs: AgentFileRoot[] = [];
  const candidates = [
    path.join(agentDir(), "agents"),
    path.join(kimiCodeHome(), "agents"),
    path.join(os.homedir(), ".agents", "agents"),
  ];
  for (const d of candidates) {
    try {
      if (fs.statSync(d).isDirectory()) {
        dirs.push({ dir: d, source: "user" as AgentFileSource });
      }
    } catch {
      // non-existent or inaccessible — skip
    }
  }
  return dirs;
}

/**
 * SYSTEM.md override path.
 * Returns path if the file exists, null otherwise.
 */
export function systemMdPath(): string | null {
  const p = path.join(agentDir(), "SYSTEM.md");
  try {
    if (fs.statSync(p).isFile()) return p;
  } catch { /* not found */ }
  return null;
}

/** Collect all discoverable roots (user + project). */
export function collectRoots(projectRoot: string | null): AgentFileRoot[] {
  const roots: AgentFileRoot[] = [];
  // User scope first (lower priority — project overrides)
  roots.push(...userRoots());
  // Project scope (higher priority)
  if (projectRoot) {
    roots.push(...projectRoots(projectRoot));
  }
  return roots;
}
