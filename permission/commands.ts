// ============================================================
// Permission Commands — /mode
// ============================================================

import type { PermissionManager } from './index';
import type { PermissionMode } from './types';

export function registerPermissionCommands(pi: any, permissionManager: PermissionManager): void {
  pi.registerCommand("mode", {
    description: "Switch permission mode (auto/yolo/manual)",
    usage: "/mode [auto|yolo|manual]",
    getArgumentCompletions: (prefix: string) => {
      const items = [
        { value: "auto", label: "auto", description: "Auto-approve all (disable ask_user_question)" },
        { value: "yolo", label: "yolo", description: "Approve after safety checks" },
        { value: "manual", label: "manual", description: "Require approval for all actions" },
        { value: "status", label: "status", description: "Show current mode" },
      ];
      if (!prefix) return items;
      return items.filter(i => i.value.startsWith(prefix.toLowerCase())) || null;
    },
    handler: async (args: string, ctx: any) => {
      const arg = (args || "").trim().toLowerCase();

      if (arg === "status" || arg === "") {
        ctx.ui.notify(`Permission mode: ${permissionManager.getMode()}`, "info");
        return;
      }

      if (arg === "auto" || arg === "yolo" || arg === "manual") {
        const mode = arg as PermissionMode;
        const prevMode = permissionManager.getMode();
        
        if (mode === prevMode) {
          ctx.ui.notify(`Permission mode is already ${mode}.`, "info");
          return;
        }

        // Confirm mode switch for safety
        if (mode === 'auto' || mode === 'yolo') {
          const confirmed = await ctx.ui.confirm(
            "Mode Switch",
            `Switch to ${mode.toUpperCase()} mode?\n\n${mode === 'auto' ? 'All actions will be auto-approved. AskUserQuestion will be disabled.' : 'Actions will be approved after safety checks (sensitive files, .git still require approval).'}`,
          );
          if (!confirmed) {
            ctx.ui.notify("Mode switch cancelled.", "info");
            return;
          }
        }

        permissionManager.setMode(mode);
        ctx.ui.setStatus("permission-mode", ctx.ui.theme.fg(
          mode === 'auto' ? 'success' : mode === 'yolo' ? 'warning' : 'accent',
          mode
        ));
        ctx.ui.notify(`Permission mode: ${mode.toUpperCase()}`, "success");
        return;
      }

      ctx.ui.notify(`Unknown mode: ${arg}. Use auto, yolo, or manual.`, "error");
    },
  });
}
