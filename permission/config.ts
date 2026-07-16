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
    try {
      if (fs.existsSync(configPath)) {
        const raw = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.deny) config.deny.push(...(parsed.deny as string[]).map(parsePattern));
        if (parsed.ask) config.ask.push(...(parsed.ask as string[]).map(parsePattern));
        if (parsed.allow) config.allow.push(...(parsed.allow as string[]).map(parsePattern));
      }
    } catch { /* ignore */ }
  }

  return config;
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
