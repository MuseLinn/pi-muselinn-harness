// ============================================================
// Permission Types — Kimi Code-style 18-level policy chain
// ============================================================

export type PermissionMode = 'manual' | 'auto' | 'yolo';

export type PolicyKind = 'approve' | 'deny' | 'ask';

export interface PolicyResult {
  kind: PolicyKind;
  reason?: string;
  message?: string;  // For 'ask' kind: message to show user
}

export interface PolicyContext {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  mode: PermissionMode;
  hasUI: boolean;
  signal?: AbortSignal;
  sessionId?: string;
  /** Raw contents of the nearest AGENTS.md (if any). */
  agentsMd?: string;
}

export interface Policy {
  id: number;
  name: string;
  evaluate(ctx: PolicyContext): PolicyResult | null | Promise<PolicyResult | null>;
}

// Read-only tools (auto-approved in all modes and plan mode)
// Kimi Code-aligned set: all safe/read-only tools are auto-approved
// so the model can explore without friction.
export const READ_ONLY_TOOLS = new Set([
  'read', 'grep', 'glob', 'find', 'ls',
  'get_goal', 'web_search', 'fetch_content',
  'read_media_file', 'read_media',
  'task_list', 'task_output',
  'cron_list',
  'agent_file_list', 'agent_file_info',
  'todo_list',
  'enter_plan_mode', 'exit_plan_mode',
  'skill',
  'select_tools',
]);

// Sensitive file patterns
export const SENSITIVE_PATTERNS = [
  /\.env$/i,
  /\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /\.pfx$/i,
  /id_rsa/i,
  /id_ed25519/i,
  /credentials/i,
  /\.npmrc$/i,
  /secrets?\//i,
];

// Git control paths
export const GIT_CONTROL_PATTERNS = [
  /\.git\//i,
  /\.git$/,
];

// Tool patterns for user config
export interface ToolPattern {
  raw: string;
  toolName?: string;
  pathPattern?: RegExp;
}

// Session approval history
export const sessionApprovals = new Map<string, Set<string>>();

// User config
export interface UserPermissionConfig {
  deny: ToolPattern[];
  ask: ToolPattern[];
  allow: ToolPattern[];
}

// State — `export const` container + property-level mutation (jiti 2.7.0
// snapshots cross-module `export let` bindings; a shared container keeps
// every importer on the same live object).
export const permissionModeState: { current: PermissionMode } = { current: 'manual' };

export function setMode(mode: PermissionMode): void {
  permissionModeState.current = mode;
}
