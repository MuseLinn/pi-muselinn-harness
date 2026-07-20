// ============================================================
// Plan Commands — /plan
// ============================================================

import type { PlanManager } from "./index";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { planArgumentCompletions } from "../completions";

/**
 * Get per-session state file path (inside session directory, keyed by sessionId).
 */
function getPlanStateFile(ctx: any): string {
  const sessionDir = ctx.sessionManager?.getSessionDir?.();
  const sessionId = ctx.sessionManager?.getSessionId?.() ?? 'default';
  if (sessionDir) return path.join(sessionDir, `.plan-state-${sessionId}.json`);
  // Fallback: temp dir
  return path.join(os.tmpdir(), `pi-plan-state-${sessionId}.json`);
}

/**
 * Write plan state to per-session file (overwrite, no accumulation).
 *
 * NOTE: This file is a best-effort session mirror / debugging aid. It is
 * intentionally NOT read back as the source of truth. The authoritative
 * in-process state lives in PlanManager (currentPlanMode.isActive), which
 * is also used by plan-mode tool gating in the extension entry point.
 * Keeping writes here allows external observers to inspect the last known
 * state without creating a second truth source.
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
    usage: "/plan [on|off|clear]",
    getArgumentCompletions: (prefix: string) => planArgumentCompletions(prefix),
    handler: async (args: string, ctx: any) => {
      const arg = (args || "").trim().toLowerCase();

      // Handle clear — Kimi Code style: clear plan content, keep plan mode state
      if (arg === "clear") {
        // Only clear plan content, don't exit plan mode
        const wasActive = planManager.isPlanModeActive();
        planManager.clearPlanContent();
        if (wasActive) {
          // Re-enter plan mode if it was active (clearPlan reset state)
          const plan = planManager.enterPlanMode("Plan cleared");
          savePlanStateToSession(ctx, true, plan);
          ctx.ui.notify("Plan content cleared. Plan mode still active.", "info");
        } else {
          ctx.ui.notify("Plan cleared. No active plan mode.", "info");
        }
        return;
      }

      // Determine action: toggle / on / off
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
        savePlanStateToSession(ctx, true, plan);
        ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
        ctx.ui.notify(`Plan mode: ON\nPlan will be created here:\n${plan.path}`, "info");
      } else {
        if (!planManager.isPlanModeActive()) {
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
