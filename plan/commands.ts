// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";

/**
 * Register plan commands with Pi.
 */
export function registerPlanCommands(pi: any, planManager: PlanManager): void {
  // ── /plan command ──
  pi.registerCommand("plan", {
    description: "Manage plan mode (toggle/on/off/clear/status)",
    usage: "/plan [on|off|clear|status]",
    handler: async (args: string, ctx: any) => {
      const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() || "";

      switch (subcommand) {
        case "on":
        case "enter":
          if (planManager.isPlanModeActive()) {
            ctx.ui.notify("Plan mode is already active.", "info");
          } else {
            planManager.enterPlanMode("User activated plan mode");
            ctx.ui.notify("Plan mode activated. Explore and write a plan.", "info");
          }
          break;

        case "off":
        case "exit":
          if (!planManager.isPlanModeActive()) {
            ctx.ui.notify("Plan mode is not active.", "info");
          } else {
            const plan = planManager.exitPlanMode();
            if (plan) {
              ctx.ui.notify("Plan mode exited. Plan submitted for review.", "info");
            }
          }
          break;

        case "clear":
        case "reset":
          planManager.clearPlan();
          ctx.ui.notify("Plan mode cleared.", "info");
          break;

        case "status":
        case "":
          ctx.ui.notify(planManager.formatSummary(), "info");
          break;

        case "approve":
          const approved = planManager.approvePlan();
          if (approved) {
            ctx.ui.notify("Plan approved! You can now execute the plan.", "success");
          } else {
            ctx.ui.notify("No plan to approve.", "error");
          }
          break;

        case "reject":
          const rejected = planManager.rejectPlan();
          if (rejected) {
            ctx.ui.notify("Plan rejected.", "info");
          } else {
            ctx.ui.notify("No plan to reject.", "error");
          }
          break;

        default:
          // Toggle plan mode
          if (planManager.isPlanModeActive()) {
            planManager.exitPlanMode();
            ctx.ui.notify("Plan mode exited.", "info");
          } else {
            planManager.enterPlanMode(args.trim() || undefined);
            ctx.ui.notify("Plan mode activated.", "info");
          }
          break;
      }
    },
  });
}
