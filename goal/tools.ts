// ============================================================
// Goal Tools — create_goal, get_goal, update_goal
// ============================================================

import type { GoalManager } from "./index";
import type { GoalSnapshot, GoalBudgetLimits } from "./types";

/**
 * Register goal tools with Pi.
 */
export function registerGoalTools(pi: any, goalManager: GoalManager): void {
  // ── create_goal tool ──
  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    promptSnippet: "create_goal / get_goal / update_goal: manage the current goal",
    promptGuidelines: [
      "Use create_goal to set a goal before starting complex multi-step work",
      "Use get_goal to check the current goal and its status",
      "Use update_goal to mark the goal status as 'complete', 'paused', or 'active'",
      "Keep the model working toward the active goal until it's complete",
    ],
    parameters: {
      type: "object",
      properties: {
        objective: { type: "string", description: "The goal objective" },
        completion_criterion: { type: "string", description: "How to verify completion" },
        budgetLimits: {
          type: "object",
          description: "Budget limits for the goal",
          properties: {
            tokenBudget: { type: "number", description: "Max tokens (input+output)" },
            turnBudget: { type: "number", description: "Max turns (LLM calls)" },
            wallClockBudgetMs: { type: "number", description: "Max wall clock time in ms" },
          },
        },
      },
      required: ["objective"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      const g = goalManager.createGoal(
        params.objective,
        params.completion_criterion,
        params.budgetLimits,
        "model",
      );
      // Update status bar after creating goal (Kimi Code-style)
      if (ctx?.ui?.setStatus && ctx?.ui?.theme) {
        ctx.ui.setStatus("goal", ctx.ui.theme.fg("accent", `[goal ● active · 0s · 0 turns]`));
      }
      return {
        content: [{ type: "text", text: `Goal created: ${g.objective}\nStatus: ${g.status}\n\n${goalManager.formatGoalPanel()}` }],
      };
    },
  });

  // ── get_goal tool ──
  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    promptSnippet: "get_goal: check the current goal status",
    promptGuidelines: [
      "Use get_goal to check the current goal and its status",
      "Check goal status before and after completing tasks",
    ],
    parameters: {
      type: "object",
      properties: {},
    },
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const goal = goalManager.getGoal();
      if (!goal) {
        return { content: [{ type: "text", text: "No active goal." }] };
      }
      return { content: [{ type: "text", text: goalManager.formatGoalPanel() }] };
    },
  });

  // ── update_goal tool ──
  pi.registerTool({
    name: "update_goal",
    label: "Update Goal",
    promptSnippet: "update_goal: update the current goal status",
    promptGuidelines: [
      "Use update_goal to mark the goal status as 'complete', 'paused', or 'active'",
      "Mark goal as 'complete' when the objective is achieved",
      "Mark goal as 'blocked' if there's an impasse",
    ],
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "paused", "blocked", "complete"],
          description: "New status for the goal",
        },
        objective: { type: "string", description: "Updated objective (optional)" },
        reason: { type: "string", description: "Reason for status change (optional)" },
      },
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const goal = goalManager.getGoal();
      if (!goal) {
        return { content: [{ type: "text", text: "No active goal to update." }] };
      }

      let updated: GoalSnapshot | null = null;

      switch (params.status) {
        case "complete":
          updated = goalManager.complete("model");
          break;
        case "paused":
          updated = goalManager.pause("model");
          break;
        case "blocked":
          updated = goalManager.block(params.reason, "model");
          break;
        case "active":
          if (goal.status === "paused" || goal.status === "blocked") {
            updated = goalManager.resume("model");
          } else {
            updated = goal;
          }
          break;
      }

      if (params.objective && updated) {
        updated = goalManager.editGoal(params.objective, undefined, "model");
      }

      return {
        content: [{ type: "text", text: `Goal updated.\n\n${goalManager.formatGoalPanel()}` }],
      };
    },
  });
}
