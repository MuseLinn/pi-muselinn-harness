// ============================================================
// Agent Lifecycle — Types
// ============================================================

export interface AgentLifecycleEvent {
  type: "agent.created" | "agent.disposed";
  agentId: string;
  agentType: string;
  /** The tool call ID that spawned this agent. */
  parentToolCallId?: string;
  /** Final status (for disposed events). */
  status?: string;
  timestamp: number;
}
