// ============================================================
// Plan Injection — Context injection for plan mode
// ============================================================

import type { PlanManager } from "./index.ts";

/**
 * Build plan mode injection for system prompt (Kimi Code-style).
 */
export function buildPlanModeInjection(planManager: PlanManager): string | undefined {
  if (!planManager.isPlanModeActive()) return undefined;

  const plan = planManager.getCurrentPlan();
  if (!plan) return undefined;

  const parts = [
    `## Plan Mode Active`,
    ``,
    `You are in Plan Mode. Your task is to:`,
    `1. Explore the codebase using read-only tools (read, grep, find, ls)`,
    `2. Write a detailed implementation plan`,
    `3. Save the plan to a file`,
    ``,
    `Plan file path: ${plan.path || 'Not set yet'}`,
    ``,
    `**IMPORTANT**: You can ONLY use read-only tools and write/edit the plan file.`,
    `Do NOT modify any source code files until the plan is approved.`,
  ];

  if (plan.content) {
    parts.push(
      ``,
      `Current plan content:`,
      `---`,
      plan.content.slice(0, 500),
      `---`,
    );
  }

  return parts.join('\n');
}

/**
 * Inject plan mode into system prompt messages.
 */
export function injectPlanMode(
  planManager: PlanManager,
  messages: Array<{ role: string; content?: any }>
): void {
  const injection = buildPlanModeInjection(planManager);
  if (!injection) return;

  for (const msg of messages) {
    if (msg.role === 'system' || msg.role === 'developer') {
      if (Array.isArray(msg.content)) {
        msg.content.push({ type: 'text', text: `\n\n---\n${injection}` });
      } else if (typeof msg.content === 'string') {
        msg.content += `\n\n---\n${injection}`;
      }
      return;
    }
  }
}
