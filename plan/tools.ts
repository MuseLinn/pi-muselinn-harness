// ============================================================
// Plan Tools — enter_plan_mode, exit_plan_mode
// ============================================================

import type { PlanManager } from "./index";

/**
 * Register plan tools with Pi.
 */
export function registerPlanTools(pi: any, planManager: PlanManager): void {
  // ── enter_plan_mode tool ──
  pi.registerTool({
    name: "enter_plan_mode",
    label: "Enter Plan Mode",
    promptSnippet: "enter_plan_mode / exit_plan_mode: manage plan mode",
    promptGuidelines: [
      "Use enter_plan_mode to start planning before complex implementation tasks",
      "Use exit_plan_mode when your plan is ready for review",
      "In plan mode, only use read-only tools (read, grep, find, ls)",
      "Write your plan to a file before calling exit_plan_mode",
    ],
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Reason for entering plan mode (optional)",
        },
      },
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      if (planManager.isPlanModeActive()) {
        return {
          content: [{ type: "text", text: "Plan mode is already active." }],
        };
      }

      const plan = planManager.enterPlanMode(params.reason);
      ctx.ui.notify("Entered plan mode. Explore codebase and write a plan.", "info");

      return {
        content: [{
          type: "text",
          text: `Plan mode activated.\nPlan ID: ${plan.id}\n\nYou can now:\n1. Explore the codebase with read-only tools\n2. Write your implementation plan\n3. Save the plan to a file\n4. Call exit_plan_mode when ready`,
        }],
      };
    },
  });

  // ── exit_plan_mode tool ──
  pi.registerTool({
    name: "exit_plan_mode",
    label: "Exit Plan Mode",
    promptSnippet: "exit_plan_mode: submit plan for review",
    promptGuidelines: [
      "Use exit_plan_mode when your plan is ready for user review",
      "Make sure you've written the plan to a file before calling this",
      "The plan will be reviewed by the user before execution",
    ],
    parameters: {
      type: "object",
      properties: {
        plan_file: {
          type: "string",
          description: "Path to the plan file (optional, will try to auto-detect)",
        },
      },
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      if (!planManager.isPlanModeActive()) {
        return {
          content: [{ type: "text", text: "Plan mode is not active." }],
        };
      }

      const plan = planManager.exitPlanMode();
      if (!plan) {
        return {
          content: [{ type: "text", text: "No plan to exit." }],
        };
      }

      ctx.ui.notify("Plan submitted for review.", "info");

      return {
        content: [{
          type: "text",
          text: `Plan submitted for review.\nPlan ID: ${plan.id}\n\nThe user will review your plan before execution.`,
        }],
      };
    },
  });
}
