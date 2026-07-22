// ============================================================
// Permission Manager — 18-level policy chain executor
// ============================================================

import type { PermissionMode, PolicyContext, PolicyResult } from './types.ts';
import { setMode, sessionApprovals } from './types.ts';
import { policyChain, isDestructive, inputFingerprint } from './policies.ts';
import { loadAgentsMd } from './config.ts';
import { hookEngine } from '../hooks/index.ts';

/** Adapter-injected approval dialog outcome. */
export interface ApprovalDialogResult {
  decision: 'once' | 'always' | 'deny';
  /** Optional user-supplied reason attached to a deny (relayed to the model). */
  reason?: string;
}
/** Adapter-injected approval dialog: three-way ask outcome. */
export type ApprovalDialogFn = (
  ctx: any,
  toolName: string,
  title: string,
  message: string,
) => Promise<ApprovalDialogResult>;

export class PermissionManager {
  private mode: PermissionMode = 'manual';
  private lastMode: PermissionMode | undefined;
  private persistFn: ((mode: PermissionMode) => void) | null = null;
  private approvalDialog: ApprovalDialogFn | null = null;

  /** Bind a persistence callback */
  setPersistence(fn: (mode: PermissionMode) => void): void {
    this.persistFn = fn;
  }

  /**
   * Inject the interactive approval dialog (adapter). When unset, asks fall
   * back to ctx.ui.confirm with the original semantics (approve = record).
   * 'once' approves without recording; 'always' approves and records for the
   * session; 'deny' blocks.
   */
  setApprovalDialog(fn: ApprovalDialogFn | null): void {
    this.approvalDialog = fn;
  }

  /** Get current permission mode */
  getMode(): PermissionMode {
    return this.mode;
  }

  /** Set permission mode */
  setMode(mode: PermissionMode): void {
    this.lastMode = this.mode !== mode ? this.mode : undefined;
    this.mode = mode;
    setMode(mode);
    if (this.persistFn) this.persistFn(mode);
  }

  /**
   * Evaluate a tool call from an unattended subagent (swarm worker).
   *
   * Workers share the session's permission manager in-process, so a mode
   * switch propagates to in-flight subagents by construction — the Kimi
   * Code #1948 fan-out is implicit here. 'ask' verdicts cannot be
   * answered by a worker, so they degrade to blocks (identical to the
   * no-UI ask path), never to silent approval.
   */
  async evaluateForSubagent(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
  ): Promise<{ block: true; reason: string } | undefined> {
    return this.evaluate(toolName, input, cwd, {
      hasUI: false,
      sessionManager: null,
      sessionId: `subagent:${process.pid}`,
    });
  }

  /**
   * Evaluate tool call through the 18-level policy chain.
   * Returns { block: true, reason } to block, or undefined to allow.
   */
  async evaluate(
    toolName: string,
    input: Record<string, unknown>,
    cwd: string,
    ctx: any
  ): Promise<{ block: true; reason: string } | undefined> {
    const sessionId: string =
      (ctx?.sessionManager?.getSessionId?.() as string) ||
      (ctx?.sessionId as string) ||
      'default';
    const policyCtx: PolicyContext = {
      toolName,
      input,
      cwd,
      mode: this.mode,
      hasUI: ctx?.hasUI ?? true,
      signal: ctx?.signal,
      sessionId,
      agentsMd: loadAgentsMd(cwd),
    };

    for (const policy of policyChain) {
      try {
        const result = await policy.evaluate(policyCtx);
        if (result === null) continue;

        if (result.kind === 'deny') {
          return { block: true, reason: result.reason || `Blocked by ${policy.name}` };
        }

        if (result.kind === 'approve') {
          // Record approval in session history (by input fingerprint).
          // Destructive actions never short-circuit history, so don't record them.
          this.recordApproval(policyCtx);
          return undefined;  // Allow
        }

        if (result.kind === 'ask') {
          if (!policyCtx.hasUI) {
            return {
              block: true,
              reason:
                `BLOCKED — tool "${toolName}" was NOT executed: this session is non-interactive (no UI), ` +
                `so the required approval (${policy.name}) could not be presented. ` +
                `Do not treat the action as completed. Ask the user to run interactively or switch permission mode (auto/yolo).`,
            };
          }
          try { void hookEngine.fire('PermissionRequest', { tool_name: toolName, policy: policy.name, message: result.message }, { matcherText: toolName, cwd }); } catch { /* hooks fail open */ }

          if (this.approvalDialog) {
            const outcome = await this.approvalDialog(ctx, toolName, 'Approval Required', result.message || `Tool: ${toolName}`);
            try { void hookEngine.fire('PermissionResult', { tool_name: toolName, policy: policy.name, approved: outcome.decision !== 'deny' }, { matcherText: toolName, cwd }); } catch { /* hooks fail open */ }
            if (outcome.decision === 'deny') {
              const why = outcome.reason ? ` — user reason: ${outcome.reason}` : '';
              return { block: true, reason: `User denied: ${policy.name}${why}` };
            }
            // 'always' records for the session; 'once' approves just this call.
            if (outcome.decision === 'always') this.recordApproval(policyCtx);
            continue;
          }

          const approved = await ctx.ui.confirm(
            'Approval Required',
            result.message || `Tool: ${toolName}\n\nAllow?`,
            { signal: ctx?.signal }
          );
          try { void hookEngine.fire('PermissionResult', { tool_name: toolName, policy: policy.name, approved: !!approved }, { matcherText: toolName, cwd }); } catch { /* hooks fail open */ }
          if (!approved) {
            return { block: true, reason: `User denied: ${policy.name}` };
          }
          // Record approval and continue to next policy
          this.recordApproval(policyCtx);
        }
      } catch {
        // Policy error: fail-safe by continuing to next policy
        continue;
      }
    }

    // All policies passed (no deny, all asks approved)
    this.recordApproval(policyCtx);
    return undefined;
  }

  /** Record tool approval in session history (keyed by input fingerprint, not toolName alone) */
  private recordApproval(policyCtx: PolicyContext): void {
    // Destructive commands are one-shot — never cached for replay.
    if (isDestructive(policyCtx)) return;

    const sessionId = policyCtx.sessionId || 'default';
    if (!sessionApprovals.has(sessionId)) {
      sessionApprovals.set(sessionId, new Set());
    }
    sessionApprovals
      .get(sessionId)!
      .add(inputFingerprint(policyCtx.toolName, policyCtx.input));
  }

  /** Reset session approval history */
  resetHistory(): void {
    sessionApprovals.clear();
  }

  /** Format mode for status bar */
  formatMode(): string {
    return this.mode;
  }

  /** Build model-facing injection text for permission mode context */
  buildInjection(): string | undefined {
    const currentMode = this.mode;
    const previousMode = this.lastMode;

    if (currentMode === previousMode) {
      // No mode change: only inject if auto mode (keep reminding)
      if (currentMode !== 'auto') return undefined;
      return `## Permission Mode: Auto

Auto permission mode is active. Tool approvals will be handled automatically while this mode remains enabled.
  - Continue normally without pausing for approval prompts.
  - Do NOT call AskUserQuestion while auto mode is active. Make a reasonable decision and continue without asking the user.
  - ExitPlanMode is also approved automatically, without the user reviewing the plan. An auto-approved plan is NOT a signal from the user to start executing — follow the user's original instructions on whether to proceed.`;
    }

    this.lastMode = currentMode;

    if (currentMode === 'auto') {
      return `## Permission Mode: Auto

Auto permission mode is now active. Tool approvals will be handled automatically.
  - Do NOT call AskUserQuestion while auto mode is active. Make a reasonable decision and continue without asking the user.
  - ExitPlanMode is also approved automatically, without the user reviewing the plan. An auto-approved plan is NOT a signal from the user to start executing — follow the user's original instructions on whether to proceed.`;
    }

    if (previousMode === 'auto') {
      return `## Permission Mode: ${currentMode.toUpperCase()}

Auto permission mode is no longer active. Tool approvals and permission checks are back to the current mode.
  - Continue normally, but expect approval prompts or denials when a tool requires them.`;
    }

    switch (currentMode) {
      case 'yolo':
        return `## Permission Mode: YOLO

YOLO permission mode is active. All actions are unconditionally allowed. You have full control over tool execution.`;
      default:
        return undefined;
    }
  }

  /**
   * Inject permission mode reminder into messages (called from context event).
   */
  injectIntoMessages(messages: Array<{ role: string; content?: any }>): void {
    const injection = this.buildInjection();
    if (!injection) return;
    // Find the last system message and append the injection
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "system") {
        if (Array.isArray(msg.content)) {
          msg.content.push({ type: "text", text: `\n\n---\n${injection}` });
        } else if (typeof msg.content === "string") {
          msg.content += `\n\n---\n${injection}`;
        }
        return;
      }
    }
  }
}

export const permissionManager = new PermissionManager();
