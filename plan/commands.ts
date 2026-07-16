// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";
import { currentPlanMode, setCurrentPlanMode } from "./types";

/**
 * Restore plan state from persisted entries (survives Pi hot-reload).
 */
function restorePlanState(ctx: any, planManager: PlanManager): void {
  try {
    const entries = ctx.sessionManager?.getEntries?.();
    if (!entries || entries.length === 0) return;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as any;
      if (e.type === "custom" && e.customType === "muselinn_plan" && e.data) {
        planManager.restoreFromData(e.data);
        return;
      }
    }
  } catch { /* not critical */ }
}

/**
 * Register plan commands with Pi.
 */
export function registerPlanCommands(pi: any, planManager: PlanManager): void {
  // ── /plan command ──
  pi.registerCommand("plan", {
    description: "Toggle plan mode on/off",
    handler: async (args: string, ctx: any) => {
      // Restore from persistence FIRST (survives Pi hot-reload)
      restorePlanState(ctx, planManager);
      
      const arg = (args || "").trim().toLowerCase();

      // Handle clear
      if (arg === "clear") {
        planManager.clearPlan();
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan mode cleared.", "info");
        return;
      }

      // Kimi Code-style: /plan (no args) = toggle, /plan on, /plan off
      let turnOn: boolean;
      if (arg === "on") {
        turnOn = true;
      } else if (arg === "off") {
        turnOn = false;
      } else if (arg === "" || arg === "toggle") {
        turnOn = !planManager.isPlanModeActive();
      } else {
        ctx.ui.notify(`Unknown plan subcommand: ${arg}`, "error");
        return;
      }

      if (turnOn) {
        if (planManager.isPlanModeActive()) {
          ctx.ui.notify("Plan mode is already ON.", "info");
          return;
        }
        const plan = planManager.enterPlanMode("User activated plan mode");
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else {
        if (!planManager.isPlanModeActive()) {
          // State says OFF but status bar might still show "plan" — clean it up
          ctx.ui.setStatus("plan-mode", undefined);
          ctx.ui.notify("Plan mode is already OFF.", "info");
          return;
        }
        planManager.exitPlanMode();
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan mode: OFF", "info");
      }
    },
  });
}
