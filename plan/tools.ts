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

      // Kimi Code-style: show Approval Panel
      const planPreview = plan.content
        ? plan.content.slice(0, 500) + (plan.content.length > 500 ? "..." : "")
        : "(empty plan)";

      const options = ["Approve", "Reject", "Revise"];
      const choice = await ctx.ui.select(
        `Plan Review:\n\n${planPreview}`,
        options,
        { timeout: 60000 }
      );

      if (choice === "Approve") {
        planManager.approvePlan();
        ctx.ui.notify("Plan approved! Execution can begin.", "success");
        return {
          content: [{ type: "text", text: `Plan approved. You can now execute the plan.` }],
        };
      } else if (choice === "Reject") {
        planManager.rejectPlan("User rejected");
        ctx.ui.notify("Plan rejected.", "info");
        return {
          content: [{ type: "text", text: `Plan rejected. Modify your plan and try again.` }],
        };
      } else {
        ctx.ui.notify("Plan revision requested. Continue editing.", "info");
        return {
          content: [{ type: "text", text: `Plan revision requested. Continue editing your plan.` }],
        };
      }
    },
  });
}
