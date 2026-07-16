// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Get per-session state file path (inside session directory, not extension folder).
 */
function getPlanStateFile(ctx: any): string {
  const sessionDir = ctx.sessionManager?.getSessionDir?.();
  if (sessionDir) return path.join(sessionDir, '.plan-state.json');
  // Fallback: temp dir
  return path.join(require('node:os').tmpdir(), `pi-plan-state-${Date.now()}.json`);
}

/**
 * Read plan isActive from per-session state file.
 * Stored in session directory — follows session, no accumulation.
 */
function isPlanActiveFromSession(ctx: any): boolean {
  try {
    const file = getPlanStateFile(ctx);
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8');
      const state = JSON.parse(raw);
      return state.isActive === true;
    }
  } catch { /* not critical */ }
  return false;
}

/**
 * Write plan state to per-session file (overwrite, no accumulation).
 */
function savePlanStateToSession(ctx: any, isActive: boolean, plan: any): void {
  try {
    const file = getPlanStateFile(ctx);
    fs.writeFileSync(file, JSON.stringify({ isActive, currentPlan: plan, timestamp: Date.now() }));
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
        savePlanStateToSession(ctx, false, null);
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
        savePlanStateToSession(ctx, true, plan);
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else {
        if (!isPlanActiveFromSession(ctx)) {
          ctx.ui.setStatus("plan-mode", undefined);
          ctx.ui.notify("Plan mode is already OFF.", "info");
          return;
        }
        planManager.exitPlanMode();
        savePlanStateToSession(ctx, false, null);
        ctx.ui.setStatus("plan-mode", undefined);
        ctx.ui.notify("Plan mode: OFF", "info");
      }
    },
  });
}
