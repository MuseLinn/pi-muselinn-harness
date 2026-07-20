// ============================================================
// Goal Commands — /goal, /write-goal, /swarm-status
// ============================================================

import type { GoalManager } from "./index";
import { parseBudgetToLimits } from "./types";
import { formatQueue, addToQueue, prioritizeQueueItem, removeFromQueue, skipCurrentQueueItem } from "./queue";
import { goalArgumentCompletions } from "../completions";

/**
 * Register goal commands with Pi.
 */
export function registerGoalCommands(pi: any, goalManager: GoalManager): void {
  // ── /goal command ──
  pi.registerCommand("goal", {
    description: "Manage the current goal (Kimi Code-style)",
    usage: "/goal <objective> | /goal pause | /goal resume | /goal cancel | /goal replace <new> | /goal next | /goal status | /goal budget <number> <unit>",
    getArgumentCompletions: (prefix: string) => goalArgumentCompletions(prefix),
    handler: async (args: string, ctx: any) => {
      const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() || "";
      const rest = args.trim().replace(/^(pause|resume|cancel|replace|next|status|queue)\s*/i, "").trim();

      switch (subcommand) {
        case "status":
        case "":
          const goal = goalManager.getGoal();
          if (!goal) {
            ctx.ui.notify("No active goal. Use /goal <objective> to set one.", "info");
          } else {
            ctx.ui.notify(goalManager.formatGoalPanel(), "info");
          }
          break;

        case "pause":
          const paused = goalManager.pause("user");
          if (paused) {
            ctx.ui.notify(`Goal paused: ${paused.objective}`, "info");
          } else {
            ctx.ui.notify("No active goal to pause.", "error");
          }
          break;

        case "resume":
          const resumed = goalManager.resume("user");
          if (resumed) {
            ctx.ui.notify(`Goal resumed: ${resumed.objective}`, "info");
          } else {
            ctx.ui.notify("No paused/blocked goal to resume.", "error");
          }
          break;

        case "cancel":
        case "clear":
          goalManager.clear("user");
          ctx.ui.notify("Goal cleared.", "info");
          break;

        case "replace":
          if (!rest) {
            ctx.ui.notify("Usage: /goal replace <new objective>", "error");
            break;
          }
          const replaced = goalManager.editGoal(rest, undefined, "user");
          if (replaced) {
            ctx.ui.notify(`Goal replaced: ${replaced.objective}`, "info");
          } else {
            ctx.ui.notify("No goal to replace. Use /goal <objective> to create one.", "error");
          }
          break;

        case "next":
          const current = goalManager.getGoal();
          if (current) {
            goalManager.complete("user");
            ctx.ui.notify(`Goal completed: ${current.objective}`, "info");
          } else {
            ctx.ui.notify("No active goal to complete.", "error");
          }
          break;

        case "queue":
          ctx.ui.notify(formatQueue(), "info");
          break;

        case "add": {
          if (!rest) {
            ctx.ui.notify("Usage: /goal add <objective>", "error");
            break;
          }
          const item = addToQueue(rest);
          ctx.ui.notify(`Added to queue: ${rest.slice(0, 60)}`, "info");
          break;
        }

        case "prioritize": {
          const index = parseInt(rest);
          if (isNaN(index)) {
            ctx.ui.notify("Usage: /goal prioritize <index>", "error");
            break;
          }
          if (prioritizeQueueItem(index)) {
            ctx.ui.notify(`Item ${index} prioritized.`, "info");
          } else {
            ctx.ui.notify(`Cannot prioritize item ${index}.`, "error");
          }
          break;
        }

        case "drop": {
          const index = parseInt(rest);
          if (isNaN(index)) {
            ctx.ui.notify("Usage: /goal drop <index>", "error");
            break;
          }
          if (removeFromQueue(index)) {
            ctx.ui.notify(`Item ${index} dropped.`, "info");
          } else {
            ctx.ui.notify(`Cannot drop item ${index}.`, "error");
          }
          break;
        }

        case "skip": {
          const next = skipCurrentQueueItem();
          if (next) {
            // /goal skip explicitly abandons the current goal, so allow overwrite.
            goalManager.createGoal(next.objective, next.completionCriterion, next.budgetLimits, "user", true);
            ctx.ui.notify(`Skipped to: ${next.objective.slice(0, 60)}`, "info");
          } else {
            ctx.ui.notify("No more items in queue.", "info");
          }
          break;
        }

        case "budget": {
          const parts = rest.trim().split(/\s+/);
          const budget = parseFloat(parts[0]);
          const unit = parts[1]?.toLowerCase();
          const validUnits = ["turns", "tokens", "ms", "s", "minutes", "hours"];
          if (Number.isNaN(budget) || !unit || !validUnits.includes(unit)) {
            ctx.ui.notify("Usage: /goal budget <number> <unit> (turns, tokens, ms, s, minutes, hours)", "error");
            break;
          }
          const limits = parseBudgetToLimits(budget, unit);
          const updated = goalManager.setBudgetLimits(limits, "user");
          if (updated) {
            ctx.ui.notify(`Goal budget updated: ${budget} ${unit}`, "info");
          } else {
            ctx.ui.notify("No active goal to set budget on.", "error");
          }
          break;
        }

        default:
          // Treat as new objective
          if (args.trim()) {
            const existing = goalManager.getGoal();
            if (existing && existing.status === "active") {
              ctx.ui.notify("Goal already active. Use /goal replace <new> to replace.", "info");
            } else {
              // P0 (1): createGoal now refuses if an active goal somehow exists
              // (race with tool-side creation). Wrap so the CLI degrades gracefully.
              try {
                goalManager.createGoal(args.trim(), undefined, undefined, "user");
              } catch (e: any) {
                ctx.ui.notify(`Cannot set goal: ${e?.message ?? String(e)}`, "error");
                break;
              }
              ctx.ui.notify(`Goal set:\n\n${goalManager.formatGoalPanel()}`, "info");
              // Update status bar (Kimi Code-style)
              if (ctx.ui?.setStatus && ctx.ui?.theme) {
                ctx.ui.setStatus("goal", ctx.ui.theme.fg("accent", `[goal ● active · 0s · 0 turns]`));
              }
            }
          } else {
            ctx.ui.notify("Usage: /goal <objective>", "error");
          }
          break;
      }
    },
  });

  // ── /write-goal command ──
  pi.registerCommand("write-goal", {
    description: "Turn a rough intention into a well-specified /goal objective",
    usage: "/write-goal <your rough intention>",
    handler: async (args: string, ctx: any) => {
      if (!args.trim()) {
        ctx.ui.notify("Usage: /write-goal <your rough intention>", "error");
        return;
      }

      // Send a message to the model to refine the goal
      const prompt = `Help me refine this intention into a clear, measurable goal. Use **create_goal** once settled.

**Intention:** ${args.trim()}

Guidelines:
- Make it specific and measurable
- Include acceptance criteria if possible
- Keep it concise (one sentence preferred)`;

      ctx.ui.notify("Refining... model will use create_goal once settled", "info");
      await pi.sendUserMessage(prompt);
    },
  });

  // ── /swarm-status command ──
  pi.registerCommand("swarm-status", {
    description: "Show goal + swarm status",
    handler: async (_args: string, ctx: any) => {
      const goal = goalManager.getGoal();
      const statusLines: string[] = [];

      if (goal) {
        statusLines.push(`Goal: ${goalManager.formatSummary()}`);
        const budget = goalManager.budgetBandGuidance();
        if (budget) statusLines.push(budget);
      } else {
        statusLines.push("No active goal.");
      }

      ctx.ui.notify(statusLines.join("\n"), "info");
    },
  });
}
