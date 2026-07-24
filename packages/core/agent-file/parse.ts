// ============================================================
// Agent File Catalog — Parse single agent file
// ============================================================
// Reads a .md file, extracts YAML frontmatter, validates fields,
// and returns an AgentFileDef.

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "../skills/frontmatter.ts";
import type { AgentFileDef, AgentFileSource } from "./types.ts";

/** Validate an agent file name (kebab-case, lowercase alphanumeric + hyphens). */
function validateName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/** Derive a name from the filename (strip .md, convert spaces to hyphens, lowercase). */
function nameFromFilename(filePath: string): string {
  const base = path.basename(filePath, ".md");
  return base
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    || `agent-${Date.now().toString(36)}`;
}

/** Normalize a tool pattern: exact name for built-ins, glob for MCP. */
function normalizePattern(p: string): string {
  return p.trim();
}

/** Parse a single agent file and return its definition, or null on error. */
export function parseAgentFile(
  filePath: string,
  source: AgentFileSource,
): AgentFileDef | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (e: any) {
    // read error (EACCES, ENOENT, etc.)
    return null;
  }

  const fm = parseFrontmatter(content);
  const data = fm.data;
  const body = fm.body.trim();

  // Extract frontmatter fields with getField-like fallback (supports aliases)
  function field(...keys: string[]): unknown {
    for (const key of keys) {
      if (key in data) return data[key];
    }
    return undefined;
  }

  // Name: from frontmatter or derive from filename
  let name = field("name") as string | undefined;
  if (!name || typeof name !== "string" || !name.trim()) {
    name = nameFromFilename(filePath);
  } else {
    name = name.trim().toLowerCase().replace(/\s+/g, "-");
  }

  // Validate name
  if (!validateName(name)) {
    return null;
  }

  // Description (required)
  const description = field("description") as string | undefined;
  if (!description || typeof description !== "string" || !description.trim()) {
    return null; // description is mandatory
  }

  // Optional fields
  const whenToUse = field("whenToUse", "when_to_use", "when") as string | undefined;
  const override = field("override") === true;

  // Tool lists: accept string[] or comma-separated string
  function parseList(val: unknown): string[] | undefined {
    if (val === undefined || val === null) return undefined;
    if (Array.isArray(val)) {
      const items = val.map((v) => normalizePattern(String(v))).filter(Boolean);
      return items.length > 0 ? items : undefined;
    }
    const s = String(val).trim();
    if (!s) return undefined;
    // Comma-separated
    const items = s.split(",").map((v) => normalizePattern(v)).filter(Boolean);
    return items.length > 0 ? items : undefined;
  }

  const tools = parseList(field("tools", "allowed_tools", "allow"));
  const disallowedTools = parseList(field("disallowedTools", "disallowed_tools", "disallow", "denied_tools"));
  const subagents = parseList(field("subagents", "subagent_types", "subagent"));

  // Body is the system prompt template
  const prompt = body || "";

  return {
    name,
    description: description.trim(),
    whenToUse: whenToUse?.trim(),
    override,
    tools,
    disallowedTools,
    subagents,
    prompt,
    path: filePath,
    source,
  };
}

/** Read SYSTEM.md override file. Returns { prompt, name } or null. */
export function parseSystemMd(filePath: string): { prompt: string; description: string } | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const fm = parseFrontmatter(content);
    const body = fm.body.trim();
    if (!body) return null;

    const data = fm.data;
    const description = (data.description as string)?.trim() || "Default agent (SYSTEM.md)";
    return {
      prompt: body,
      description,
    };
  } catch {
    return null;
  }
}
