// ============================================================
// Swarm — permission gate wrapper for subagent tools (pure).
//
// Workers run unattended, so every tool call they make passes through
// the shared PermissionManager (evaluateForSubagent): the session's
// mode applies to them by construction — a /mode switch propagates to
// in-flight subagents with no fan-out needed — and 'ask' verdicts
// degrade to blocks rather than silent approvals.
// ============================================================

export interface ToolGateVerdict {
  block: true;
  reason: string;
}

export type ToolGate = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<ToolGateVerdict | undefined>;

/**
 * Wrap one pi Tool object so its execute() is gated. The gate failing
 * open is deliberate: a broken policy chain must not wedge the swarm.
 */
export function wrapWithPermissionGate(tool: any, gate: ToolGate): any {
  if (!tool || typeof tool.execute !== "function") return tool;
  return {
    ...tool,
    execute: async (toolCallId: string, params: any, signal?: AbortSignal, onUpdate?: (r: any) => void) => {
      try {
        const verdict = await gate(String(tool.name ?? ""), params ?? {});
        if (verdict?.block) {
          return {
            content: [{ type: "text", text: `Blocked by permission policy: ${verdict.reason}` }],
            details: undefined,
          };
        }
      } catch { /* gate failures fail open */ }
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}
