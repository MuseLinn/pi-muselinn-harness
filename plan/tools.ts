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
      properties: {},
      required: [],
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
    promptSnippet: "exit_plan_mode: submit plan for review with optional alternative approaches",
    promptGuidelines: [
      "Use exit_plan_mode when your plan is ready for user review",
      "Make sure you've written the plan to a file before calling this",
      "The plan will be reviewed by the user before execution",
      "You can provide 1-3 alternative approaches via the options parameter",
      "Each option needs a label (max 80 chars) and description",
      "Append '(Recommended)' to the label of your recommended option",
      "Do not use reserved labels: Approve, Reject, Reject and Exit, Revise",
    ],
    parameters: {
      type: "object",
      properties: {
        plan_file: {
          type: "string",
          description: "Path to the plan file (optional, will try to auto-detect)",
        },
        options: {
          type: "array",
          description: "1-3 alternative approaches for the user to choose from during approval",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short name (1-8 words, max 80 chars). Append (Recommended) if recommended." },
              description: { type: "string", description: "Brief summary of this approach and its trade-offs" },
            },
            required: ["label", "description"],
          },
          maxItems: 3,
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

      // Kimi Code-style: show Approval Panel with optional alternatives
      const planPreview = plan.content
        ? plan.content.slice(0, 500) + (plan.content.length > 500 ? "..." : "")
        : "(empty plan)";

      // Build options: Approve / Reject / Revise + LLM-provided alternatives
      const RESERVED = ["Approve", "Reject", "Reject and Exit", "Revise"];
      const alternatives = (params.options || []) as { label: string; description: string }[];
      const validAlternatives = alternatives.filter(
        (opt) => opt.label && !RESERVED.some((r) => r.toLowerCase() === opt.label.toLowerCase())
      ).slice(0, 3);

      // If alternatives provided, show them first then action buttons
      if (validAlternatives.length > 0) {
        const altLabels = validAlternatives.map((a) => a.label);
        const allOptions = [...altLabels, "Approve", "Reject", "Revise"];
        
        const choice = await ctx.ui.select(
          `Plan Review:\n\n${planPreview}\n\nChoose an approach:`,
          allOptions,
          { timeout: 60000 }
        );

        // If user selected an alternative, approve with that approach
        if (choice && altLabels.includes(choice)) {
          const selected = validAlternatives.find((a) => a.label === choice)!;
          planManager.approvePlan();
          ctx.ui.notify(`Plan approved with approach: ${choice}`, "success");
          return {
            content: [{ type: "text", text: `Plan approved with approach: ${choice}\n${selected.description}\n\nYou can now execute the plan.` }],
          };
        }

        if (choice === "Approve") {
          planManager.approvePlan();
          ctx.ui.notify("Plan approved! Execution can begin.", "success");
          return { content: [{ type: "text", text: `Plan approved. You can now execute the plan.` }] };
        } else if (choice === "Reject") {
          planManager.rejectPlan("User rejected");
          ctx.ui.notify("Plan rejected.", "info");
          return { content: [{ type: "text", text: `Plan rejected. Modify your plan and try again.` }] };
        } else {
          // Revise: re-enter plan mode so LLM can keep editing
          planManager.enterPlanMode("Plan revision requested");
          if (ctx.ui?.theme) {
            ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
          }
          ctx.ui.notify("Plan revision requested. Continue editing.", "info");
          return { content: [{ type: "text", text: `Plan revision requested. Continue editing your plan.` }] };
        }
      }

      // No alternatives: simple Approve/Reject/Revise
      const options = ["Approve", "Reject", "Revise"];
      const choice = await ctx.ui.select(
        `Plan Review:\n\n${planPreview}`,
        options,
        { timeout: 60000 }
      );

      if (choice === "Approve") {
        planManager.approvePlan();
        ctx.ui.notify("Plan approved! Execution can begin.", "success");
        return { content: [{ type: "text", text: `Plan approved. You can now execute the plan.` }] };
      } else if (choice === "Reject") {
        planManager.rejectPlan("User rejected");
        ctx.ui.notify("Plan rejected.", "info");
        return { content: [{ type: "text", text: `Plan rejected. Modify your plan and try again.` }] };
      } else {
        // Revise: re-enter plan mode so LLM can keep editing
        planManager.enterPlanMode("Plan revision requested");
        if (ctx.ui?.theme) {
          ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        }
        ctx.ui.notify("Plan revision requested. Continue editing.", "info");
        return { content: [{ type: "text", text: `Plan revision requested. Continue editing your plan.` }] };
      }
    },
  });
}
