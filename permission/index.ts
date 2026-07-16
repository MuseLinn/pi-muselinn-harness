// ============================================================
// Permission Manager — 18-level policy chain executor
// ============================================================

import type { PermissionMode, PolicyContext, PolicyResult } from './types';
import { currentMode, setMode, sessionApprovals } from './types';
import { policyChain } from './policies';

export class PermissionManager {
  private mode: PermissionMode = 'manual';

  /** Get current permission mode */
  getMode(): PermissionMode {
    return this.mode;
  }

  /** Set permission mode */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
    setMode(mode);
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
    const policyCtx: PolicyContext = {
      toolName,
      input,
      cwd,
      mode: this.mode,
      hasUI: ctx?.hasUI ?? true,
      signal: ctx?.signal,
    };

    for (const policy of policyChain) {
      try {
        const result = await policy.evaluate(policyCtx);
        if (result === null) continue;

        if (result.kind === 'deny') {
          return { block: true, reason: result.reason || `Blocked by ${policy.name}` };
        }

        if (result.kind === 'approve') {
          // Record approval in session history
          this.recordApproval(toolName);
          return undefined;  // Allow
        }

        if (result.kind === 'ask') {
          if (!policyCtx.hasUI) {
            return { block: true, reason: `${policy.name}: no UI available for approval` };
          }
          const approved = await ctx.ui.confirm(
            'Approval Required',
            result.message || `Tool: ${toolName}\n\nAllow?`,
            { signal: ctx?.signal }
          );
          if (!approved) {
            return { block: true, reason: `User denied: ${policy.name}` };
          }
          // Record approval and continue to next policy
          this.recordApproval(toolName);
        }
      } catch {
        // Policy error: fail-safe by continuing to next policy
        continue;
      }
    }

    // All policies passed (no deny, all asks approved)
    this.recordApproval(toolName);
    return undefined;
  }

  /** Record tool approval in session history */
  private recordApproval(toolName: string): void {
    const sessionId = 'current';
    if (!sessionApprovals.has(sessionId)) {
      sessionApprovals.set(sessionId, new Set());
    }
    sessionApprovals.get(sessionId)!.add(toolName);
  }

  /** Reset session approval history */
  resetHistory(): void {
    sessionApprovals.clear();
  }

  /** Format mode for status bar */
  formatMode(): string {
    return this.mode;
  }
}

export const permissionManager = new PermissionManager();
