// ============================================================
// Swarm Mode — Slash Commands
// ============================================================

import type { AutocompleteItem } from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ModelTier, SubAgentType } from "./types";
import {
  currentSwarm,
  cancelPending,
  cancelTimer,
  savedSwarmState,
  activeSessions,
  swarmCancelled,
  setCancelPending,
  setCancelTimer,
  setSwarmCancelled,
  setSavedSwarmState,
  setGlobalAbortController,
  globalAbortController,
  currentGoal,
  setCurrentGoal,
} from "./types";
import { fmtDuration, fmtTokens, fmtCost } from "./helpers";
import { buildWidgetLines } from "./widget";
import { TasksBrowserComponent, TasksBrowserProps } from "./task-browser";
import { goalManager } from "../goal";
import { UserCancellationError } from "./subagent";

export function registerCommands(pi: ExtensionAPI): void {
  const piSendUser = pi.sendUserMessage.bind(pi);
  // ============================================================
  // /swarm - Main swarm control
  // ============================================================
  pi.registerCommand("swarm", {
    description: "Toggle swarm mode or run one task in swarm mode",
    usage: "/swarm [on|off] | <task>",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items: AutocompleteItem[] = [
        { value: "on", label: "on", description: "Turn swarm mode ON" },
        { value: "off", label: "off", description: "Turn swarm mode OFF" },
      ];
      if (!prefix) return items;
      return items.filter(i => i.value.startsWith(prefix.toLowerCase())) || null;
    },
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();

      if (arg === "on") {
        // Load on-demand from state
        const { default: state } = await import("../state");
        state.swarmEnabled = true;
        ctx.ui.setStatus("swarm-mode", ctx.ui.theme.fg("accent", "swarm"));
        ctx.ui.notify("🐝 Swarm mode: ON", "success");
      } else if (arg === "off") {
        const { default: state } = await import("../state");
        state.swarmEnabled = false;
        ctx.ui.setStatus("swarm-mode", undefined);
        ctx.ui.notify(" Swarm mode: OFF", "info");
      } else if (arg === "status") {
        const { default: state } = await import("../state");
        let msg = `Swarm mode: ${state.swarmEnabled ? "ON ✓" : "OFF ✗"}`;
        if (savedSwarmState) {
          const completed = savedSwarmState.completedItems.length;
          const total = savedSwarmState.items.length;
          msg += `  |  Resume available: ${completed}/${total} completed`;
        }
        ctx.ui.notify(msg, "info");
      } else {
        // Treat as quick task — parse and dispatch
        ctx.ui.notify(`Send a message to start a swarm for: ${arg}`, "info");
      }
    },
  });

  // ============================================================
  // /cancel - Two-step cancellation
  // ============================================================
  pi.registerCommand("cancel", {
    description: "Cancel running swarm (two-step confirmation)",
    handler: async (args, ctx) => {
      if ((args || "").trim() === "--force") {
        setCancelPending(false);
        if (cancelTimer) { clearTimeout(cancelTimer); setCancelTimer(null); }
        setSwarmCancelled(true);
        // Abort via parent controller → propagates to all children
        if (globalAbortController && !globalAbortController.signal.aborted) {
          globalAbortController.abort(new UserCancellationError());
        }
        ctx.ui.notify(" Swarm cancelled.", "warning");
        return;
      }

      if (cancelPending) {
        setCancelPending(false);
        if (cancelTimer) { clearTimeout(cancelTimer); setCancelTimer(null); }
        setSwarmCancelled(true);
        if (globalAbortController && !globalAbortController.signal.aborted) {
          globalAbortController.abort(new UserCancellationError());
        }
        ctx.ui.notify(" Swarm cancelled.", "warning");
      } else {
        setCancelPending(true);
        ctx.ui.notify(" Press /cancel again to cancel the running swarm", "warning");
        setCancelTimer(
          setTimeout(() => {
            setCancelPending(false);
            setCancelTimer(null);
          }, 10_000),
        );
      }
    },
  });

  // ============================================================
  // /swarm-resume - Resume interrupted swarm
  // ============================================================
  pi.registerCommand("swarm-resume", {
    description: "Resume interrupted swarm from where it left off (supports resume_agent_ids)",
    handler: async (_args, ctx) => {
      const ss = savedSwarmState;
      if (!ss) {
        ctx.ui.notify("No saved swarm to resume.", "info");
        return;
      }

      const { name, items, modelTier, subagentType, promptTemplate, maxConcurrency } = ss;
      const pendingItems = items.filter(
        (item) => !ss.completedItems.includes(item),
      );

      if (pendingItems.length === 0) {
        ctx.ui.notify(
          "All tasks already completed. Nothing to resume.",
          "info",
        );
        setSavedSwarmState(null);
        return;
      }

      setSavedSwarmState(null);

      const itemsStr = pendingItems.map((i) => `"${i}"`).join(", ");
      ctx.ui.notify(
        `Resuming ${name}: ${pendingItems.length}/${items.length} remaining`,
        "info",
      );

      pi.sendUserMessage(
        `Continue the interrupted swarm. Use agent_swarm with description="${name}", prompt_template="${promptTemplate}", items=[${itemsStr}], subagent_type="${subagentType}", model_tier="${modelTier}", max_concurrency=${maxConcurrency}`,
      );
    },
  });

  // ============================================================
  // /tasks - Kimi Code-style Task Browser (Component architecture)
  // ============================================================
  pi.registerCommand("tasks", {
    description: "Browse tasks with Kimi Code-style 3-panel browser",
    handler: async (_args, ctx) => {
      const theme = ctx.ui.theme;
      let refreshTimer: ReturnType<typeof setInterval> | null = null;
      let component: TasksBrowserComponent | null = null;

      // Persistent state managed by the handler
      let filter: "all" | "active" = "all";
      let selectedTaskId: string | undefined;
      let outputPreview: string | undefined;
      let flashMessage: string | undefined;

      // Helper to build props with current state + live tasks
      function buildProps(done: (v?: any) => void): TasksBrowserProps {
        return {
          tasks: currentSwarm?.tasks || [],
          filter,
          selectedTaskId,
          outputPreview,
          flashMessage,
          onSelect: (taskId: string) => { selectedTaskId = taskId; },
          onToggleFilter: () => {
            filter = filter === "all" ? "active" : "all";
          },
          onRefresh: () => { /* timer handles refresh */ },
          onCancel: () => { done(undefined); },
          onStopConfirmed: (taskId: string) => {
            // Abort the session for this task
            if (activeSessions) {
              const entry = activeSessions.get(taskId);
              if (entry) entry.session.abort().catch(() => {});
            }
          },
          onOpenOutput: (taskId: string) => {
            const s = currentSwarm;
            if (!s) return;
            const task = s.tasks.find(t => t.id === taskId);
            if (!task) return;
            // Use real output from task.outputLines
            outputPreview = task.outputLines?.join("\n") || `[no output captured]\nTask: ${task.id}\nStatus: ${task.status}\nModel: ${task.model}`;
          },
        };
      }

      await ctx.ui.custom(
        (_tui, _theme, _kb, done) => {
          // Create component on first render
          if (!component) {
            component = new TasksBrowserComponent(buildProps(done), theme);
          }

          // Auto-refresh every 1s — push latest state + tasks
          refreshTimer = setInterval(() => {
            if (component) {
              component.setProps(buildProps(done));
            }
            _tui?.invalidate?.();
          }, 1000);

          return {
            render: (width: number) => component!.render(width),
            invalidate: () => component?.invalidate(),
            handleInput: (data: string) => {
              if (data === "\x1b" || data.toLowerCase() === "q") {
                if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
                component = null;  // Prevent last refresh from triggering setProps
                done(undefined);
                return;
              }
              if (component) component.handleInput(data);
            },
          };
        },
        { overlay: true },
      );

      if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    },
  });

}
