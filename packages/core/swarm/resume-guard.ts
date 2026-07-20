// ============================================================
// Swarm resume guard (pure) — kimi subagent resume validation parity
// (agent.ts:302-316: must be a subagent, belong to the parent, and be
// idle before resuming). For our /swarm-resume that maps to: there is
// a saved interrupted swarm, it has remaining items, and no other
// swarm is currently in flight.
// ============================================================

export interface SavedSwarmLike {
  items: string[];
  completedItems: string[];
}

export interface ResumeValidation {
  ok: boolean;
  reason?: string;
  /** Remaining (not-yet-completed) item names when ok. */
  pendingItems: string[];
}

/**
 * Validate a /swarm-resume attempt. `saved` is the persisted interrupted
 * swarm (null when none); `inFlight` is the currently running swarm
 * state (null when idle).
 */
export function validateSwarmResume(
  saved: SavedSwarmLike | null,
  inFlight: { status: string } | null,
): ResumeValidation {
  if (!saved) {
    return { ok: false, reason: "No saved swarm to resume.", pendingItems: [] };
  }
  if (inFlight && inFlight.status === "running") {
    return {
      ok: false,
      reason: "A swarm is already running — /cancel it first (or wait for it to finish).",
      pendingItems: [],
    };
  }
  const pendingItems = saved.items.filter((item) => !saved.completedItems.includes(item));
  if (pendingItems.length === 0) {
    return { ok: false, reason: "All tasks already completed. Nothing to resume.", pendingItems: [] };
  }
  return { ok: true, pendingItems };
}
