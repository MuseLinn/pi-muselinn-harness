// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";
import * as fs from "node:fs";
import * as path from "node:path";

const STATE_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '.',
  '.pi', 'agent', 'extensions', 'pi-muselinn-harness', '.plan-state.json'
);

/** Read isActive directly from file (bypasses all module state) */
function isPlanActiveFromFile(): boolean {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const state = JSON.parse(raw);
      return state.isActive === true;
    }
  } catch { /* ignore */ }
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
      // For toggle, read directly from file to bypass module hot-reload issues
      let turnOn: boolean;
      if (arg === "on") {
        turnOn = true;
      } else if (arg === "off") {
        turnOn = false;
      } else if (arg === "" || arg === "toggle") {
        turnOn = !isPlanActiveFromFile();
      } else {
        ctx.ui.notify(`Unknown plan subcommand: ${arg}`, "error");
        return;
      }

      if (turnOn) {
        if (isPlanActiveFromFile()) {
          ctx.ui.notify("Plan mode is already ON.", "info");
          return;
        }
        const plan = planManager.enterPlanMode("User activated plan mode");
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else {
        if (!isPlanActiveFromFile()) {
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
