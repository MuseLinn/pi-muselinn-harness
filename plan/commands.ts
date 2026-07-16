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
    description: "Toggle plan mode on/off",
    handler: async (args: string, ctx: any) => {
      const arg = (args || "").trim().toLowerCase();

      // Determine action: toggle / on / off
      let turnOn: boolean;
      if (arg === "on") {
        turnOn = true;
      } else if (arg === "off") {
        turnOn = false;
      } else {
        // Toggle
        turnOn = !planManager.isPlanModeActive();
      }

      if (turnOn && !planManager.isPlanModeActive()) {
        const plan = planManager.enterPlanMode("User activated plan mode");
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else if (!turnOn && planManager.isPlanModeActive()) {
        planManager.exitPlanMode();
        ctx.ui.setStatus("plan-mode", "");
        ctx.ui.notify("Plan mode: OFF", "info");
      }
    },
  });
}
