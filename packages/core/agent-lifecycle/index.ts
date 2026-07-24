// ============================================================
// Agent Lifecycle — Event Bus & Active Agent Tracking
// ============================================================

import type { AgentLifecycleEvent } from "./types.ts";

type LifecycleHandler = (event: AgentLifecycleEvent) => void;

export class AgentLifecycle {
  private handlers: Set<LifecycleHandler> = new Set();
  private activeAgents: Map<string, AgentLifecycleEvent> = new Map();

  /** Emit a lifecycle event. */
  emit(event: Omit<AgentLifecycleEvent, "timestamp">): void {
    const fullEvent: AgentLifecycleEvent = {
      ...event,
      timestamp: Date.now(),
    };

    // Track active agents
    if (event.type === "agent.created") {
      this.activeAgents.set(event.agentId, fullEvent);
    } else if (event.type === "agent.disposed") {
      this.activeAgents.delete(event.agentId);
    }

    // Notify subscribers
    for (const handler of this.handlers) {
      try {
        handler(fullEvent);
      } catch {
        // subscriber must not break the bus
      }
    }
  }

  /** Subscribe to lifecycle events. Returns unsubscribe function. */
  subscribe(handler: LifecycleHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Get all currently active agents. */
  getActiveAgents(): AgentLifecycleEvent[] {
    return Array.from(this.activeAgents.values());
  }

  /** Get count of currently active agents. */
  getActiveCount(): number {
    return this.activeAgents.size;
  }

  /** Clear all active agent tracking. */
  reset(): void {
    this.activeAgents.clear();
  }
}

/** Singleton instance. */
export const agentLifecycle = new AgentLifecycle();
