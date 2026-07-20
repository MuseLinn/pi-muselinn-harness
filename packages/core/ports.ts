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
