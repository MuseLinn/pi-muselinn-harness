// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Read plan isActive directly from session entries (per-session, survives hot-reload).
 * This bypasses module state which resets on Pi hot-reload.
 */
function isPlanActiveFromSession(ctx: any): boolean {
  try {
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? 'default';
    const stateFile = path.join(
      process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '.',
      '.pi', 'agent', 'extensions', 'pi-muselinn-harness', `.plan-state-${sessionId}.json`
    );
    if (fs.existsSync(stateFile)) {
      const raw = fs.readFileSync(stateFile, 'utf-8');
      const state = JSON.parse(raw);
      return state.isActive === true;
    }
  } catch (err) {
    console.error('[plan] isPlanActiveFromSession error:', err);
  }
  return false;
}

function savePlanStateForSession(ctx: any, isActive: boolean, plan: any): void {
  try {
    const sessionId = ctx.sessionManager?.getSessionId?.() ?? 'default';
    const stateFile = path.join(
      process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '.',
      '.pi', 'agent', 'extensions', 'pi-muselinn-harness', `.plan-state-${sessionId}.json`
    );
    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ isActive, currentPlan: plan }));
  } catch (err) {
    console.error('[plan] savePlanStateForSession error:', err);
  }
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

      // Handle clear — Kimi Code style: clear plan content, exit plan mode
      if (arg === "clear") {
        planManager.clearPlan();
        savePlanStateForSession(ctx, false, null);
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
        savePlanStateForSession(ctx, true, plan);
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else {
        if (!isPlanActiveFromSession(ctx)) {
          ctx.ui.setStatus("plan-mode", undefined);
          ctx.ui.notify("Plan mode is already OFF.", "info");
          return;
        }
        planManager.exitPlanMode();
        savePlanStateForSession(ctx, false, null);
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan mode: OFF", "info");
      }
    },
  });
}
