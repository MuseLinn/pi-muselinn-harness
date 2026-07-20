// ============================================================
// Background task state — persistence shape + restore logic (pure).
//
// Split from the adapter's task manager (task/index.ts): everything
// about *persisting and restoring* task state lives here and never
// touches session spawn. The manager keeps the live map and delegates
// to these functions on the persistence boundary.
// ============================================================

export interface BackgroundTaskEntry {
  id: string;
  prompt: string;
  model: string;
  subagentType: string;
  status: "running" | "completed" | "failed" | "aborted";
  outputLines: string[];
  error?: string;
  stopReason?: string;          // Kimi Code: reason report to model
  startTime: number;
  createdAt: number;            // task creation timestamp (used for stale cleanup)
  endTime?: number;
  completedAtMs?: number;       // completion timestamp (set on complete/fail/restart-demotion)
  turns: number;
  usage: { input: number; output: number; cost: number };
}

export const BG_ARRAY_ENTRY_TYPE = "muselinn_background_tasks"; // legacy full-snapshot entry
export const BG_TASK_ENTRY_TYPE = "muselinn_background_task";   // incremental single-task entry

/** Strip a task down to its persisted shape (outputLines are not persisted). */
export function serializeTask(t: BackgroundTaskEntry): Record<string, any> {
  return {
    id: t.id,
    prompt: t.prompt,
    model: t.model,
    subagentType: t.subagentType,
    status: t.status,
    error: t.error,
    stopReason: t.stopReason,
    startTime: t.startTime,
    createdAt: t.createdAt,
    endTime: t.endTime,
    completedAtMs: t.completedAtMs,
    turns: t.turns,
    usage: t.usage,
  };
}

/**
 * Merge persisted entries into the final per-id task data, in entry order.
 * Accepts either the raw session entry list (preferred) or a legacy plain
 * array of task objects. Handles both entry types:
 *  - "muselinn_background_tasks" (array): full snapshot — resets the merge
 *    baseline (used for deletions such as clearCompleted).
 *  - "muselinn_background_task" (single object): upserts one task; for the
 *    same id the later entry wins.
 */
export function mergePersistedTaskEntries(entries: any[]): any[] {
  const merged = new Map<string, any>();
  let sawSessionEntries = false;
  for (const e of entries || []) {
    if (e && e.type === "custom") {
      sawSessionEntries = true;
      if (e.customType === BG_ARRAY_ENTRY_TYPE && Array.isArray(e.data)) {
        merged.clear(); // snapshot is authoritative up to this point
        for (const t of e.data) if (t && t.id) merged.set(t.id, t);
      } else if (e.customType === BG_TASK_ENTRY_TYPE && e.data && e.data.id) {
        merged.set(e.data.id, e.data);
      }
    }
  }
  if (!sawSessionEntries) {
    // Legacy call shape: plain array of task objects.
    for (const t of entries || []) {
      if (t && t.id) merged.set(t.id, t);
    }
  }
  return [...merged.values()];
}

/**
 * Compute the live entry for one merged restore candidate, applying the
 * demotion rules:
 *  - Tasks older than 7 days are demoted to failed with stopReason="stale_7d".
 *  - Orphan running tasks (left "running" across a process restart) are
 *    demoted to "failed" with stopReason="process_restart" so the UI never
 *    shows zombie forever-running tasks after a crash/restart.
 */
export function computeRestoredTask(e: any, now: number): BackgroundTaskEntry {
  const STALE_AGE_MS = 7 * 86400 * 1000;
  const createdAt = e.createdAt || e.startTime || now;
  const isStale = now - createdAt > STALE_AGE_MS;
  const wasRunning = e.status === "running";
  let status: BackgroundTaskEntry["status"] = e.status || "failed";
  let stopReason = e.stopReason;
  let endTime = e.endTime;
  let completedAtMs = e.completedAtMs;

  if (isStale) {
    status = "failed";
    stopReason = "stale_7d";
    endTime = now;
    completedAtMs = now;
  } else if (wasRunning) {
    status = "failed";
    stopReason = "process_restart";
    endTime = now;
    completedAtMs = now;
  }

  return {
    ...e,
    status,
    stopReason,
    endTime,
    completedAtMs,
    createdAt,
    outputLines: [],
  };
}
