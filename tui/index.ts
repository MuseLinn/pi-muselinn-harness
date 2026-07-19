// ============================================================
// TUI — Runtime wiring: boxed/compact editor chrome, /tui command,
// working spinner.
//
// Performance rules (see README): the spinner timer only runs while the
// agent is working; event handlers only assign state + requestRender;
// all formatting happens lazily inside render().
// ============================================================

import { type EditorStyle } from "./box";
import { loadTuiConfig, saveTuiConfig, type TuiConfig } from "./config";
import { MuselinnEditor } from "./editor";
import { parseTuiArgs } from "./parse";
import { planStyleSwitch } from "./switch";
import { renderTiming, isTimingEnabled } from "./timing";
import { setMathEnabled, isMathEnabled } from "../math/index";
import { tuiArgumentCompletions } from "../completions";
import { getSpinnerFrames } from "../swarm/helpers";
import { FRAME_INTERVAL_MS } from "../swarm/types";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";

interface TuiRuntime {
  pi: ExtensionAPI | null;
  ctx: ExtensionContext | null;
  tui: TUI | null;
  style: EditorStyle;
  modelInBorder: boolean;
  editor: MuselinnEditor | null;
  working: boolean;
  workingMessage: string | undefined;
  runningTools: Set<string>;
  spinnerIndex: number;
  spinnerTimer: ReturnType<typeof setInterval> | null;
}

const rt: TuiRuntime = {
  pi: null,
  ctx: null,
  tui: null,
  style: "boxed",
  modelInBorder: false,
  editor: null,
  working: false,
  workingMessage: undefined,
  runningTools: new Set(),
  spinnerIndex: 0,
  spinnerTimer: null,
};

// ── Border slots ──────────────────────────────────────────────

/**
 * Optional badge for the top border's left slot (e.g. plan mode).
 * Injected by the host (index.ts) so the tui module stays decoupled
 * from plan/permission internals. Evaluated lazily per render — the
 * provider must be a cheap in-memory check.
 */
let badgeProvider: (() => string | undefined) | null = null;

export function setTuiBadgeProvider(fn: (() => string | undefined) | null): void {
  badgeProvider = fn;
}

function slotLeft(): string {
  const ctx = rt.ctx;
  if (!ctx) return "";
  const theme = ctx.ui.theme;
  const parts: string[] = [];
  let badge: string | undefined;
  try { badge = badgeProvider?.() ?? undefined; } catch { badge = undefined; }
  if (badge) parts.push(theme.fg("warning", badge));
  if (rt.working) {
    const frames = getSpinnerFrames();
    const frame = frames[rt.spinnerIndex % frames.length];
    parts.push(theme.fg("accent", frame));
    if (rt.workingMessage) parts.push(theme.fg("dim", rt.workingMessage));
  }
  return parts.join(" ");
}

function slotRight(): string {
  const ctx = rt.ctx;
  if (!ctx || !rt.modelInBorder) return "";
  const theme = ctx.ui.theme;
  const provider = ctx.model?.provider;
  const id = ctx.model?.id;
  if (!provider && !id) return "";
  let level = "";
  try {
    const l = (rt.pi?.getThinkingLevel?.() ?? "") as string;
    level = l && l !== "off" ? `:${l}` : "";
  } catch { /* older pi without getThinkingLevel */ }
  return theme.fg("dim", [provider, `${id ?? ""}${level}`].filter(Boolean).join(" · "));
}

// ── Style application (ui-injectable for tests) ───────────────

interface TuiUiLike {
  setEditorComponent(factory: any): void;
  setWorkingVisible(visible: boolean): void;
}

/**
 * Apply an editor chrome style. plain unregisters the custom editor so
 * pi's default editor returns; boxed/compact register a fresh factory
 * (pi hot-swaps, preserving text/focus/keybindings).
 */
export function applyStyleToUi(ui: TuiUiLike, style: EditorStyle): void {
  rt.style = style;
  const plan = planStyleSwitch(style);
  ui.setWorkingVisible(plan.workingVisible);
  if (!plan.registerFactory) {
    rt.editor = null;
    ui.setEditorComponent(undefined);
    return;
  }
  ui.setEditorComponent((tui: TUI, theme: any, keybindings: any) => {
    rt.tui = tui;
    rt.editor = new MuselinnEditor(
      tui,
      theme,
      keybindings,
      style,
      { left: slotLeft, right: slotRight },
      isTimingEnabled() ? renderTiming : null,
    );
    return rt.editor;
  });
}

// ── Spinner lifecycle ─────────────────────────────────────────

function stopSpinner(): void {
  if (rt.spinnerTimer) {
    clearInterval(rt.spinnerTimer);
    rt.spinnerTimer = null;
  }
}

function startSpinner(): void {
  stopSpinner();
  rt.spinnerTimer = setInterval(() => {
    if (!rt.working) return;
    rt.spinnerIndex += 1;
    try { rt.tui?.requestRender(); } catch { /* stale tui */ }
  }, FRAME_INTERVAL_MS);
}

function setWorking(working: boolean, message?: string): void {
  rt.working = working;
  rt.workingMessage = message;
  try { rt.tui?.requestRender(); } catch { /* stale tui */ }
}

// ── Config helpers ────────────────────────────────────────────

function persistConfig(): void {
  const config: TuiConfig = { style: rt.style, modelInBorder: rt.modelInBorder, math: isMathEnabled() };
  saveTuiConfig(config);
}

// ── Registration ──────────────────────────────────────────────

export function registerTui(pi: ExtensionAPI): void {
  rt.pi = pi;

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    rt.ctx = ctx;

    let config: TuiConfig;
    try {
      config = loadTuiConfig(ctx.sessionManager.getCwd());
    } catch {
      config = { style: "boxed", modelInBorder: false, math: true };
    }

    // Reset per-session working state before re-applying chrome.
    rt.working = false;
    rt.workingMessage = undefined;
    rt.runningTools.clear();
    rt.spinnerIndex = 0;
    rt.modelInBorder = config.modelInBorder;
    setMathEnabled(config.math);

    applyStyleToUi(ctx.ui, config.style);
  });

  pi.on("agent_start", () => {
    rt.runningTools.clear();
    setWorking(true, undefined);
    startSpinner();
  });

  pi.on("message_update", (event: any) => {
    if (rt.runningTools.size > 0) return;
    switch (event?.assistantMessageEvent?.type) {
      case "thinking_start":
      case "thinking_delta":
      case "thinking_end":
        setWorking(true, "Thinking");
        break;
      case "text_start":
      case "text_delta":
      case "text_end":
        setWorking(true, "Streaming");
        break;
      case "toolcall_start":
      case "toolcall_delta":
      case "toolcall_end":
        setWorking(true, "Running tools");
        break;
      default:
        break;
    }
  });

  pi.on("tool_execution_start", (event: any) => {
    if (event?.toolCallId) rt.runningTools.add(event.toolCallId);
    setWorking(true, "Running tools");
  });

  pi.on("tool_execution_end", (event: any) => {
    if (event?.toolCallId) rt.runningTools.delete(event.toolCallId);
    setWorking(true, rt.runningTools.size > 0 ? "Running tools" : undefined);
  });

  pi.on("agent_end", () => {
    rt.runningTools.clear();
  });

  pi.on("agent_settled", () => {
    rt.runningTools.clear();
    setWorking(false, undefined);
    stopSpinner();
  });

  pi.on("session_shutdown", () => {
    stopSpinner();
    rt.ctx = null;
    rt.tui = null;
    rt.editor = null;
    rt.working = false;
    rt.workingMessage = undefined;
    rt.runningTools.clear();
  });

  pi.registerCommand("tui", {
    description: "Switch editor chrome (Kimi Code-style boxed editor) and math rendering",
    usage: "/tui style <plain|boxed|compact> | /tui math <on|off> | /tui timing",
    getArgumentCompletions: (prefix: string) => tuiArgumentCompletions(prefix),
    handler: async (args: string, ctx: any) => {
      if (!ctx?.hasUI) return;
      const cmd = parseTuiArgs(args);

      switch (cmd.kind) {
        case "status": {
          const lines = [`tui: style=${rt.style} · modelInBorder=${rt.modelInBorder} · math=${isMathEnabled()}`];
          if (isTimingEnabled()) lines.push(renderTiming.format());
          ctx.ui.notify(lines.join("\n"), "info");
          break;
        }
        case "style": {
          applyStyleToUi(ctx.ui, cmd.style);
          persistConfig();
          ctx.ui.notify(`tui style: ${cmd.style}`, "info");
          break;
        }
        case "math": {
          setMathEnabled(cmd.enabled);
          persistConfig();
          ctx.ui.notify(`tui math: ${cmd.enabled ? "on" : "off"}`, "info");
          break;
        }
        case "timing": {
          if (!isTimingEnabled()) {
            ctx.ui.notify("timing is off — restart pi with PI_MUSELINN_HARNESS_TUI_TIMING=1", "info");
          } else {
            ctx.ui.notify(renderTiming.format(), "info");
          }
          break;
        }
        case "error": {
          ctx.ui.notify(cmd.message, "error");
          break;
        }
      }
    },
  });
}

// Test-only access to the runtime state.
export const __tuiRuntime = rt;
