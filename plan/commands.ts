// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";

/**
 * Read plan isActive directly from session entries (per-session, survives hot-reload).
 * This bypasses module state which resets on Pi hot-reload.
 */
function isPlanActiveFromSession(ctx: any): boolean {
  try {
    const entries = ctx.sessionManager?.getEntries?.() ?? ctx.session?.getEntries?.() ?? ctx.sessionManager?.entries ?? [];
    if (!entries || entries.length === 0) {
      console.error('[plan] No entries found. ctx keys:', Object.keys(ctx).join(','));
      return false;
    }
    // Scan from latest to oldest — find the last muselinn_plan entry
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as any;
      if (e.type === "custom" && e.customType === "muselinn_plan" && e.data) {
        return e.data.isActive === true;
      }
    }
    console.error('[plan] No muselinn_plan entry in', entries.length, 'entries');
  } catch (err) {
    console.error('[plan] isPlanActiveFromSession error:', err);
  }
  return false;
}

/**
 * Register plan commands with Pi.
 */
export function registerPlanCommands(pi: any, planManager: PlanManager): void {
  // ── /plan command ──
  pi.registerCommand("plan", {
    description: "Toggle plan mode on/off",
    handler: async (args: string, ctx: any) => {
      const arg = (args || "").trim().toLowerCase();

      // Handle clear
      if (arg === "clear") {
        planManager.clearPlan();
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan mode cleared.", "info");
        return;
      }

      // Determine action: toggle / on / off
      // For toggle, read directly from session entries (per-session, survives hot-reload)
      let turnOn: boolean;
      if (arg === "on") {
        turnOn = true;
      } else if (arg === "off") {
        turnOn = false;
      } else if (arg === "" || arg === "toggle") {
        turnOn = !isPlanActiveFromSession(ctx);
      } else {
        ctx.ui.notify(`Unknown plan subcommand: ${arg}`, "error");
        return;
      }

      if (turnOn) {
        if (isPlanActiveFromSession(ctx)) {
          ctx.ui.notify("Plan mode is already ON.", "info");
          return;
        }
        const plan = planManager.enterPlanMode("User activated plan mode");
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else {
        if (!isPlanActiveFromSession(ctx)) {
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
