// ============================================================
// Agent File Catalog — Types
// ============================================================

/** Source scope of an agent file. */
export type AgentFileSource = 'project' | 'user' | 'explicit';

/** A discovered agent file definition (raw, before profile expansion). */
export interface AgentFileDef {
  name: string;
  description: string;
  whenToUse?: string;
  override: boolean;
  /** Tool allow-list (undefined = all allowed, [] = none allowed). */
  tools?: string[];
  /** Tool deny-list (applied after allow-list). */
  disallowedTools?: string[];
  /** Allowed subagent types (undefined = all allowed). */
  subagents?: string[];
  /** Markdown body of the file (system prompt template). */
  prompt: string;
  /** Absolute path to the source file. */
  path: string;
  source: AgentFileSource;
}

/** Resolved agent profile (ready for use by subagent dispatch). */
export interface AgentProfile {
  name: string;
  description: string;
  whenToUse?: string;
  tools?: string[];
  disallowedTools?: string[];
  subagents?: string[];
  systemPrompt: string;
  /** True when this profile comes from SYSTEM.md override. */
  isDefault?: boolean;
  /** Source file path (empty for built-in / SYSTEM.md). */
  sourcePath?: string;
  source: AgentFileSource;
}

/** A search root for agent file discovery. */
export interface AgentFileRoot {
  dir: string;
  source: AgentFileSource;
}

/** Result of a discovery scan. */
export interface AgentFileDiscoveryResult {
  agents: AgentFileDef[];
  errors: string[];
  scannedRoots: string[];
}

/** A skipped/errored file during discovery. */
export interface SkippedAgentFile {
  path: string;
  reason: string;
}
