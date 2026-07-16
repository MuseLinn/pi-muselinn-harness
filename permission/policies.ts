// ============================================================
// 18-Level Policy Chain — Kimi Code-style permission policies
// ============================================================

import type { Policy, PolicyContext, PolicyResult } from './types';
import { READ_ONLY_TOOLS, SENSITIVE_PATTERNS, GIT_CONTROL_PATTERNS, sessionApprovals } from './types';
import { loadUserConfig, matchesPattern } from './config';
import * as path from 'node:path';

// ── 01: agent-swarm-exclusive-deny ──────────────────────────────────────
// Swarm 约束：swarm 模式下只允许 swarm 相关工具
export const policy01SwarmDeny: Policy = {
  id: 1,
  name: 'agent-swarm-exclusive-deny',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    // In swarm mode, block tools that conflict with swarm execution
    // (This is a placeholder — actual swarm constraints depend on module state)
    return null;
  },
};

// ── 02: auto-mode-ask-user-question-deny ────────────────────────────────
// auto 模式禁用 ask_user_question
export const policy02AutoAskDeny: Policy = {
  id: 2,
  name: 'auto-mode-ask-user-question-deny',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (ctx.mode !== 'auto') return null;
    if (ctx.toolName === 'ask_user_question') {
      return { kind: 'deny', reason: 'AskUserQuestion is disabled in auto mode' };
    }
    return null;
  },
};

// ── 03: plan-mode-guard-deny ────────────────────────────────────────────
// plan 模式只允许只读工具 + plan 文件
export const policy03PlanGuard: Policy = {
  id: 3,
  name: 'plan-mode-guard-deny',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    // Plan mode check is handled by plan module's shouldBlockTool
    // This policy is a pass-through — actual logic in plan/index.ts
    return null;
  },
};

// ── 04: user-configured-deny ────────────────────────────────────────────
// 用户自定义 deny 规则
export const policy04UserDeny: Policy = {
  id: 4,
  name: 'user-configured-deny',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    const config = loadUserConfig(ctx.cwd);
    for (const pattern of config.deny) {
      if (matchesPattern(pattern, ctx.toolName, ctx.input, ctx.cwd)) {
        return { kind: 'deny', reason: `Blocked by permissions.deny: ${pattern.raw}` };
      }
    }
    return null;
  },
};

// ── 05: auto-mode-approve ───────────────────────────────────────────────
// auto 模式：批准一切（短路）
export const policy05AutoApprove: Policy = {
  id: 5,
  name: 'auto-mode-approve',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (ctx.mode === 'auto') {
      return { kind: 'approve', reason: 'Auto mode: auto-approved' };
    }
    return null;
  },
};

// ── 06: session-approval-history ────────────────────────────────────────
// 会话中已批准过的操作
export const policy06SessionHistory: Policy = {
  id: 6,
  name: 'session-approval-history',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    // Check if this tool was previously approved in this session
    const sessionId = 'current'; // Simplified — could use ctx.sessionManager
    const approvals = sessionApprovals.get(sessionId);
    if (approvals && approvals.has(ctx.toolName)) {
      return { kind: 'approve', reason: 'Previously approved in this session' };
    }
    return null;
  },
};

// ── 07: user-configured-ask ─────────────────────────────────────────────
// 用户自定义 ask 规则
export const policy07UserAsk: Policy = {
  id: 7,
  name: 'user-configured-ask',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    const config = loadUserConfig(ctx.cwd);
    for (const pattern of config.ask) {
      if (matchesPattern(pattern, ctx.toolName, ctx.input, ctx.cwd)) {
        return {
          kind: 'ask',
          message: `Rule: ${pattern.raw}\n\nAction: ${ctx.toolName}\n\nAllow this action?`,
        };
      }
    }
    return null;
  },
};

// ── 08: user-configured-allow ───────────────────────────────────────────
// 用户自定义 allow 规则
export const policy08UserAllow: Policy = {
  id: 8,
  name: 'user-configured-allow',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    const config = loadUserConfig(ctx.cwd);
    for (const pattern of config.allow) {
      if (matchesPattern(pattern, ctx.toolName, ctx.input, ctx.cwd)) {
        return { kind: 'approve', reason: `Allowed by permissions.allow: ${pattern.raw}` };
      }
    }
    return null;
  },
};

// ── 09: exit-plan-mode-review-ask ───────────────────────────────────────
// plan 模式退出审查
export const policy09ExitPlanReview: Policy = {
  id: 9,
  name: 'exit-plan-mode-review-ask',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    // Handled by exit_plan_mode tool's own confirm dialog
    return null;
  },
};

// ── 10: goal-start-review-ask ───────────────────────────────────────────
// goal 创建时模式切换审查
export const policy10GoalStartReview: Policy = {
  id: 10,
  name: 'goal-start-review-ask',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    // When create_goal is called, check if mode should switch
    if (ctx.toolName === 'create_goal' && ctx.mode === 'auto') {
      return {
        kind: 'ask',
        message: 'Creating a goal in auto mode. Switch to manual mode for goal tracking?',
      };
    }
    return null;
  },
};

// ── 11: plan-mode-tool-approve ──────────────────────────────────────────
// plan 模式允许的工具
export const policy11PlanToolApprove: Policy = {
  id: 11,
  name: 'plan-mode-tool-approve',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    // Handled by plan module's shouldBlockTool
    return null;
  },
};

// ── 12: sensitive-file-access-ask ───────────────────────────────────────
// 敏感文件路径（.env 等）
export const policy12SensitiveFile: Policy = {
  id: 12,
  name: 'sensitive-file-access-ask',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (ctx.toolName !== 'write' && ctx.toolName !== 'edit' && ctx.toolName !== 'bash') return null;
    
    const filePath = (ctx.input.path as string) || (ctx.input.file_path as string) || '';
    if (!filePath) return null;
    const resolved = path.resolve(ctx.cwd, filePath);
    
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(resolved) || pattern.test(filePath)) {
        return {
          kind: 'ask',
          message: `Sensitive file detected: ${filePath}\n\nThis file may contain secrets. Allow access?`,
        };
      }
    }
    return null;
  },
};

// ── 13: git-control-path-access-ask ─────────────────────────────────────
// .git 目录访问
export const policy13GitControl: Policy = {
  id: 13,
  name: 'git-control-path-access-ask',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (ctx.toolName !== 'write' && ctx.toolName !== 'edit' && ctx.toolName !== 'bash') return null;
    
    const filePath = (ctx.input.path as string) || (ctx.input.file_path as string) || '';
    if (!filePath) return null;
    const resolved = path.resolve(ctx.cwd, filePath);
    
    for (const pattern of GIT_CONTROL_PATTERNS) {
      if (pattern.test(resolved) || pattern.test(filePath)) {
        return {
          kind: 'ask',
          message: `Git control path detected: ${filePath}\n\nAllow access to .git directory?`,
        };
      }
    }
    return null;
  },
};

// ── 14: yolo-mode-approve ───────────────────────────────────────────────
// yolo 模式：批准（在安全检查之后）
export const policy14YoloApprove: Policy = {
  id: 14,
  name: 'yolo-mode-approve',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (ctx.mode === 'yolo') {
      return { kind: 'approve', reason: 'Yolo mode: approved (after safety checks)' };
    }
    return null;
  },
};

// ── 15: swarm-mode-agent-swarm-approve ──────────────────────────────────
// swarm 工具批准
export const policy15SwarmApprove: Policy = {
  id: 15,
  name: 'swarm-mode-agent-swarm-approve',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (ctx.toolName === 'agent_swarm' || ctx.toolName === 'agent') {
      return { kind: 'approve', reason: 'Swarm tool approved' };
    }
    return null;
  },
};

// ── 16: default-tool-approve ────────────────────────────────────────────
// 只读/安全工具（Read, Grep, WebSearch...）
export const policy16DefaultApprove: Policy = {
  id: 16,
  name: 'default-tool-approve',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (READ_ONLY_TOOLS.has(ctx.toolName)) {
      return { kind: 'approve', reason: `Read-only tool: ${ctx.toolName}` };
    }
    return null;
  },
};

// ── 17: git-cwd-write-approve ───────────────────────────────────────────
// 工作区内 git 写操作
export const policy17GitCwdWrite: Policy = {
  id: 17,
  name: 'git-cwd-write-approve',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    if (ctx.toolName !== 'bash') return null;
    const command = (ctx.input.command as string) || '';
    if (/git\s+(add|commit|push|pull|merge|rebase|checkout|stash)/i.test(command)) {
      return { kind: 'approve', reason: 'Git command in working directory' };
    }
    return null;
  },
};

// ── 18: fallback-ask ────────────────────────────────────────────────────
// 兜底：始终弹出审批面板
export const policy18FallbackAsk: Policy = {
  id: 18,
  name: 'fallback-ask',
  evaluate(ctx: PolicyContext): PolicyResult | null {
    return {
      kind: 'ask',
      message: `Tool: ${ctx.toolName}\n\nAction requires approval. Allow?`,
    };
  },
};

// ── Policy Chain ─────────────────────────────────────────────────────────
export const policyChain: Policy[] = [
  policy01SwarmDeny,
  policy02AutoAskDeny,
  policy03PlanGuard,
  policy04UserDeny,
  policy05AutoApprove,
  policy06SessionHistory,
  policy07UserAsk,
  policy08UserAllow,
  policy09ExitPlanReview,
  policy10GoalStartReview,
  policy11PlanToolApprove,
  policy12SensitiveFile,
  policy13GitControl,
  policy14YoloApprove,
  policy15SwarmApprove,
  policy16DefaultApprove,
  policy17GitCwdWrite,
  policy18FallbackAsk,
];
