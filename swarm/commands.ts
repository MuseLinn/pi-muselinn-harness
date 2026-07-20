// ============================================================
// Swarm Mode — Slash Commands
// ============================================================

import type { AutocompleteItem } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  currentSwarm,
  cancelPending,
  cancelTimer,
  savedSwarmState,
  activeSessions,
  setCancelPending,
  setCancelTimer,
  setSwarmCancelled,
  setSavedSwarmState,
  globalAbortController,
} from "../packages/core/swarm/types";
import { TasksBrowserComponent, TasksBrowserProps } from "./task-browser";
import { UserCancellationError } from "./subagent";
import { swarmArgumentCompletions } from "../packages/core/completions";

/**
 * Open the Kimi Code-style 3-panel Task Browser overlay.
 * Shared by the /tasks command and the ctrl+shift+t shortcut.
 *
 * Single destroy path for every overlay exit (ESC/q, onCancel, stop
 * confirm, pi-side close): clears the 1s refresh interval AND the
 * component's 5s stop-confirmation timer. Idempotent.
 */
export async function openTaskBrowser(ctx: ExtensionContext): Promise<void> {
  const theme = ctx.ui.theme;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let component: TasksBrowserComponent | null = null;

  // Persistent state managed by the launcher
  let filter: "all" | "active" = "all";
  let selectedTaskId: string | undefined;
  let outputPreview: string | undefined;
  let flashMessage: string | undefined;

  const cleanup = () => {
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    component?.dispose();
    component = null; // Prevent a late refresh tick from touching setProps
  };

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
        // Abort the session for this task — surface failures instead of swallowing
        if (activeSessions) {
          const entry = activeSessions.get(taskId);
          if (entry) entry.session.abort().catch((e: unknown) => {
            const msg = e instanceof Error ? e.message : String(e);
            try { ctx.ui.notify(`Failed to abort task ${taskId}: ${msg}`, "error"); } catch { console.error(`[swarm] abort failed for ${taskId}:`, msg); }
          });
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

  try {
    await ctx.ui.custom(
      (_tui, _theme, kb, done) => {
        // Create component on first render; hand it pi's keybindings so
        // named keys (tui.select.up/down/confirm/cancel/pageUp/pageDown)
        // honor user overrides.
        if (!component) {
          component = new TasksBrowserComponent(buildProps(done), theme);
        }
        component.setKeybindings(kb);

        // Auto-refresh every 1s — push latest state + tasks, but only when
        // something visible actually changed (fingerprint gate, same design
        // as the swarm widget). Unchanged ticks skip setProps entirely and
        // never touch the TUI; changed ticks use requestRender (diffed
        // repaint) instead of invalidate (full repaint), so the overlay
        // rides pi's differential renderer.
        let lastTickFp: string | null = null;
        refreshTimer = setInterval(() => {
          if (!component) return;
          const tasks = currentSwarm?.tasks || [];
          let fp = `${filter}:${selectedTaskId ?? ""}:${outputPreview?.length ?? 0}:${flashMessage ?? ""}`;
          for (const t of tasks) {
            fp += `#${t.id}:${t.status}:${t.toolCalls}/${t.estimatedTotalCalls}:${t.currentAction ?? ""}:${(t.outputLines || []).length}`;
          }
          if (fp === lastTickFp) return;
          lastTickFp = fp;
          component.setProps(buildProps(done));
          _tui?.requestRender?.();
        }, 1000);

        return {
          render: (width: number) => component!.render(width),
          invalidate: () => component?.invalidate(),
          handleInput: (data: string) => {
            // Let the component consume input first while its output
            // viewer is open or a stop confirmation is pending, so
            // ESC/q close the viewer / cancel the confirmation instead
            // of closing the whole overlay.
            if (component?.wantsInput()) {
              component.handleInput(data);
              return;
            }
            if (data === "\x1b" || data.toLowerCase() === "q") {
              // done() → pi close() → wrapper.dispose() → cleanup()
              done(undefined);
              return;
            }
            if (component) component.handleInput(data);
          },
          // pi calls dispose() on every close path (resolve/reject of
          // ctx.ui.custom), so this is the single reliable destroy hook.
          dispose: () => { cleanup(); },
        };
      },
      { overlay: true },
    );
  } finally {
    // Backstop: factory threw or custom() rejected before dispose ran.
    cleanup();
  }
}

export function registerCommands(pi: ExtensionAPI): void {
  // ============================================================
  // /swarm - Main swarm control
  // ============================================================
  pi.registerCommand("swarm", {
    description: "Toggle swarm mode or run one task in swarm mode",
    usage: "/swarm [on|off|status] | <task>",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null =>
      swarmArgumentCompletions(prefix),
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
      await openTaskBrowser(ctx);
    },
  });

  // ============================================================
  // ctrl+shift+t — open the Task Browser from anywhere.
  // (ctrl+t is pi's built-in "toggle thinking blocks" and reserved,
  // so pi would skip it; ctrl+shift+t is free.) Registration is
  // best-effort: any failure degrades to a warning, never a load error.
  // ============================================================
  try {
    pi.registerShortcut("ctrl+shift+t", {
      description: "Open the swarm task browser",
      handler: async (ctx) => {
        try {
          await openTaskBrowser(ctx);
        } catch (e) {
          console.warn("[swarm] ctrl+shift+t task browser failed:", e);
        }
      },
    });
  } catch (e) {
    console.warn("[swarm] registerShortcut(ctrl+shift+t) unavailable, skipping:", e);
  }

}
