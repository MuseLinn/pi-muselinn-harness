// ============================================================
// Goal Tools — create_goal, get_goal, update_goal
// ============================================================

import type { GoalManager } from "./index.ts";
import type { GoalSnapshot, GoalBudgetLimits } from "./types.ts";
import { parseBudgetToLimits } from "./types.ts";

/**
 * Register goal tools with Pi.
 */
export function registerGoalTools(pi: any, goalManager: GoalManager): void {
  // ── create_goal tool ──
  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    promptSnippet: "create_goal / get_goal / update_goal / set_goal_budget: manage the current goal",
    promptGuidelines: [
      "Use create_goal to set a goal before starting complex multi-step work",
      "Use get_goal to check the current goal and its status",
      "Use update_goal to mark the goal status as 'complete', 'paused', or 'active'",
      "Use set_goal_budget to add or update a budget limit on the active goal",
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
        replace: {
          type: "boolean",
          description: "Set to true to overwrite an already-active goal. Defaults to false.",
        },
      },
      required: ["objective"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      // P0 (1): active guard surfaces here; createGoal throws when an active
      // goal exists and replace is not explicitly true.
      let g: GoalSnapshot;
      try {
        g = goalManager.createGoal(
          params.objective,
          params.completion_criterion,
          params.budgetLimits,
          "model",
          params.replace === true,
        );
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Cannot create goal: ${err?.message ?? String(err)}` }],
        };
      }
      // Update status bar after creating goal (Kimi Code-style)
      if (ctx?.ui?.setStatus && ctx?.ui?.theme) {
        ctx.ui.setStatus("goal", ctx.ui.theme.fg("accent", `[goal ● active · 0s · 0 turns]`));
      }
      return {
        content: [{ type: "text", text: `Goal created: ${g.objective}\nStatus: ${g.status}\n\n${goalManager.formatGoalPanel(g)}` }],
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
    async execute(_toolCallId: string, _params: any, _signal: any, _onUpdate: any, ctx: any) {
      goalManager.tryRestoreFromSession(ctx);
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
        verified: {
          type: "boolean",
          description:
            "Required=true when marking complete AND the goal has a declared completionCriterion. Ignored otherwise.",
        },
      },
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      goalManager.tryRestoreFromSession(ctx);
      const goal = goalManager.getGoal();
      if (!goal) {
        return { content: [{ type: "text", text: "No active goal to update." }] };
      }

      let updated: GoalSnapshot | null = null;

      switch (params.status) {
        case "complete":
          // P0 (2): pass caller's `verified` through; complete() refuses if a
          // criterion is declared but verified is not true.
          updated = goalManager.complete("model", undefined, params.verified === true);
          if (!updated) {
            return {
              content: [{
                type: "text",
                text:
                  "Cannot complete goal: a completionCriterion is declared. " +
                  "Pass verified=true once the criterion has been confirmed satisfied.",
              }],
            };
          }
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

  // ── set_goal_budget tool ──
  pi.registerTool({
    name: "set_goal_budget",
    label: "Set Goal Budget",
    promptSnippet: "set_goal_budget: update budget limits for the current goal",
    promptGuidelines: [
      "Use set_goal_budget to add or update a budget limit on the active goal",
      "Units: turns, tokens, ms, s, minutes, hours",
    ],
    parameters: {
      type: "object",
      properties: {
        budget: { type: "number", description: "Budget value" },
        unit: {
          type: "string",
          enum: ["turns", "tokens", "ms", "s", "minutes", "hours"],
          description: "Budget unit",
        },
      },
      required: ["budget", "unit"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, ctx: any) {
      goalManager.tryRestoreFromSession(ctx);
      const goal = goalManager.getGoal();
      if (!goal) {
        return { content: [{ type: "text", text: "No active goal to set budget on." }] };
      }
      const limits = parseBudgetToLimits(Number(params.budget), String(params.unit));
      const updated = goalManager.setBudgetLimits(limits, "model");
      if (!updated) {
        return { content: [{ type: "text", text: "Failed to set goal budget." }] };
      }
      return {
        content: [{ type: "text", text: `Goal budget updated.\n\n${goalManager.formatGoalPanel()}` }],
      };
    },
  });
}
