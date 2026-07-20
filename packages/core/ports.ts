// ============================================================
// Core Ports — host-provided capabilities consumed by core modules.
//
// The pi extension (adapter) implements these with the pi API; the
// MusePi fork implements them natively. Core modules NEVER import the
// host — they receive ports via bind*() injection. This file is the
// only contract between @muselinn/core and its hosts.
// ============================================================

/** A single session entry as returned by PersistencePort.entries(). */
export interface SessionEntryLike {
  type: string;
  customType?: string;
  data?: unknown;
}

/**
 * Append-only session persistence (goal/task/cron/plan state).
 *
 * Write path: bound once at startup via append(). Implementations MUST
 * tolerate calls that arrive after session teardown (timers, background
 * completions) — fail safe, never throw.
 *
 * Read path: entries() is resolved lazily per call, so the adapter can
 * point it at the freshest session context on every session_start.
 */
export interface PersistencePort {
  append(entryType: string, data: unknown): void;
  entries(): Iterable<SessionEntryLike>;
}

/**
 * Host directory layout for config/skill lookup. Core modules default to
 * pi's conventions; the MusePi fork passes its own layout. Cross-tool
 * compat dirs (.kimi-code, .agents) are NOT part of this — they are
 * external standards and stay constant.
 */
export interface ScopeDirs {
  /** Project root (walking base for project-scope lookup). */
  projectDir: string;
  /** Host agent home, e.g. ~/.pi/agent. */
  agentDir: string;
  /** User home. */
  homeDir: string;
  /** Host dot-dir name, default ".pi" (the fork may use its own). */
  hostDirName?: string;
}
