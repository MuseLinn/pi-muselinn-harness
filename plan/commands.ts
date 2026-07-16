// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";

/**
 * Read plan isActive directly from session entries.
 * Per-session, survives hot-reload, stored with session records.
 */
function isPlanActiveFromSession(ctx: any): boolean {
  try {
    const entries = ctx.sessionManager?.getEntries?.() ?? [];
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i] as any;
      if (e.type === "custom" && e.customType === "muselinn_plan" && e.data) {
        return e.data.isActive === true;
      }
    }
  } catch { /* not critical */ }
  return false;
}

/**
 * Write plan state to session entries (stored with session records).
 */
function savePlanStateToSession(pi: any, isActive: boolean, plan: any): void {
  try {
    pi.appendEntry("muselinn_plan", { isActive, currentPlan: plan, timestamp: Date.now() });
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
      const arg = (args || "").trim().toLowerCase();

      // Handle clear — Kimi Code style: clear plan file content, keep plan mode OFF
      if (arg === "clear") {
        planManager.clearPlan();
        savePlanStateToSession(pi, false, null);
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan cleared.", "info");
        return;
      }

      // Determine action: toggle / on / off
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
        savePlanStateToSession(pi, true, plan);
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else {
        if (!isPlanActiveFromSession(ctx)) {
          ctx.ui.setStatus("plan-mode", undefined);
          ctx.ui.notify("Plan mode is already OFF.", "info");
          return;
        }
        planManager.exitPlanMode();
        savePlanStateToSession(pi, false, null);
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan mode: OFF", "info");
      }
    },
  });
}
