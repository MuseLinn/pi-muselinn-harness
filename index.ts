/**
 * Swarm Mode Extension for Pi
 *
 * Kimi Code-style in-process swarm with:
 * - `createAgentSession()` + `session.prompt()` for same-process subagents
 * - Grid layout with braille progress bars (adaptive columns)
 * - Status bar with segmented pip display
 * - model_tier routing via ctx.modelRegistry
 * - Two-step /cancel confirmation, resume via /resume
 * - ctx.ui.setWidget() for non-blocking display
 */

// ============================================================
// Entry Point — registers tools and commands
// ============================================================

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import type { ModelTier, SubAgentType } from "./swarm/types";
import { setResumeResult } from "./swarm/types";
import {
  FRAME_INTERVAL_MS,
  currentSwarm,
  activeSessions,
  cancelPending,
  cancelTimer,
  savedSwarmState,
  setCurrentSwarm,
  setActiveSessions,
  setCancelPending,
  setCancelTimer,
  setSwarmCancelled,
  setSavedSwarmState,
  setGlobalAbortController,
  globalAbortController,
} from "./swarm/types";
import { getDefaultModel, getDefaultProvider, runSubAgent, runProgressive, linkAbortSignal } from "./swarm/subagent";
import { buildWidgetLines } from "./swarm/widget";
import { formatReport } from "./swarm/report";
import { registerCommands } from "./swarm/commands";
import { goalManager } from "./goal";
import { planManager } from "./plan";
import { permissionManager } from "./permission";
import { registerPermissionCommands } from "./permission/commands";
import { backgroundManager, registerBackgroundTools } from "./task";
import shared from "./state";

// Interactive question tools (copied from Pi SDK examples)


const GOAL_ENTRY_TYPE = "muselinn_goal";

export default function (pi: ExtensionAPI) {
  // ── Goal persistence: save on every change ──
  goalManager.setPersistence((data) => {
    if (data) {
      pi.appendEntry(GOAL_ENTRY_TYPE, data);
    }
  });

  // ── Plan mode: inject plan context + tool restrictions ──
  // Plan state is managed per-session via file in session directory (see plan/commands.ts)

  // ── Background task manager binding ──
  backgroundManager.bind(
    (type, data) => pi.appendEntry(type, data),
    (msg, type) => { /* notifications handled via appendEntry */ },
  );

  // ── session_start: restore goal + plan from persisted entries + set status bar ──
  pi.on("session_start", async (_event, ctx) => {
    // Refresh model catalog once at startup (Pi 0.80.8 async refresh)
    try { await ctx.modelRegistry?.refresh?.(); } catch { /* non-critical */ }

    if (shared.swarmEnabled) {
      ctx.ui.setStatus("swarm-mode", ctx.ui.theme.fg("accent", "swarm"));
    }
    if (planManager.isPlanModeActive()) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "plan"));
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }
    // Permission mode status bar
    const mode = permissionManager.getMode();
    ctx.ui.setStatus("permission-mode", ctx.ui.theme.fg(
      mode === 'auto' ? 'success' : mode === 'yolo' ? 'warning' : 'accent',
      mode
    ));
    // Goal status bar (Kimi Code-style)
    const goalBadge = goalManager.buildFooterBadge();
    if (goalBadge) {
      const color = goalManager.getFooterBadgeColor();
      ctx.ui.setStatus("goal", ctx.ui.theme.fg(color, goalBadge));
    }
    // Restore goal from session custom entries (latest wins)
    try {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e.type === "custom" && e.customType === GOAL_ENTRY_TYPE && e.data) {
          goalManager.restoreFromData(e.data);
          break;
        }
      }
    } catch { /* not critical */ }

    // Restore plan state from persisted entries
    try {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e.type === "custom" && e.customType === "muselinn_plan" && e.data) {
          planManager.restoreFromData(e.data);
          break;
        }
      }
    } catch { /* not critical */ }

    // Restore background tasks from persisted entries
    try {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e.type === "custom" && e.customType === "muselinn_background_tasks" && Array.isArray(e.data)) {
          backgroundManager.restore(e.data);
          break;
        }
      }
    } catch { /* not critical */ }
  });

  // ── session_before_compact: preserve goal across compaction (@narumitw style) ──
  pi.on("session_before_compact", (event, _ctx) => {
    const goal = goalManager.getGoal();
    if (goal && goal.status === "active") {
      // @narumitw/pi-goal style: preserve active goal across compaction
      // Goal remains active, no changes needed
      console.log(`[goal] Preserving active goal across compaction: ${goal.objective.slice(0, 50)}`);
    }
  });

  // ── session_compact: handle overflow recovery ──
  pi.on("session_compact", (event, _ctx) => {
    const goal = goalManager.getGoal();
    if (!goal) return;

    // Context overflow recovery: auto-block goal
    if (event.reason === "overflow" && goal.status === "active") {
      goalManager.block("Context overflow", "runtime");
      _ctx.ui.notify("Goal blocked: context overflow", "warning");
    }

    // Preserve goal across compaction (all reasons)
    // @narumitw/pi-goal style: goal stays active, continues after compaction
  });

  // ── context: inject goal + plan into system prompt ──
  pi.on("context", (event, _ctx) => {
    goalManager.injectIntoMessages(event.messages);
    planManager.injectIntoMessages(event.messages);
  });

  // ── Helper: update goal status bar ──
  function updateGoalStatusBar(ctx: any) {
    const badge = goalManager.buildFooterBadge();
    if (badge) {
      const color = goalManager.getFooterBadgeColor();
      ctx.ui.setStatus("goal", ctx.ui.theme.fg(color, badge));
    } else {
      ctx.ui.setStatus("goal", undefined);
    }
  }

  // ── turn_end: record token usage + budget check (pi-codex-goal style) ──
  pi.on("turn_end", (event, _ctx) => {
    const msg = event.message as any;
    if (msg?.role === "assistant" && msg?.usage) {
      const tokens = (msg.usage.input || 0) + (msg.usage.output || 0);
      if (tokens > 0) {
        const { crossedBudget } = goalManager.recordTurn(tokens);
        if (crossedBudget) {
          _ctx.ui.notify("Goal budget exceeded — goal blocked.", "warning");
        }
        updateGoalStatusBar(_ctx);
      }
    }

    // Detect context overflow in assistant messages
    if (msg?.role === "assistant" && msg?.stopReason === "error") {
      const errorMsg = msg?.errorMessage || "";
      if (/context|overflow|too many tokens/i.test(errorMsg)) {
        goalManager.block("Context overflow", "runtime");
        _ctx.ui.notify("Goal blocked: context overflow", "warning");
      }
    }

    // Detect provider limit errors (429)
    if (msg?.role === "assistant" && msg?.stopReason === "error") {
      const errorMsg = msg?.errorMessage || "";
      goalManager.detectProviderLimitError(errorMsg);
    }

    // Pause goal on user interrupt (Kimi Code-style)
    if (event.signal?.aborted) {
      goalManager.pauseOnInterrupt("User interrupted");
    }
  });

  // ── Register goal tools and commands (from goal/ module) ──
  goalManager.registerTools(pi);
  goalManager.registerCommands(pi);

  // ── Register plan tools and commands (from plan/ module) ──
  planManager.registerTools(pi);
  planManager.registerCommands(pi);

  // ── Register permission commands ──
  registerPermissionCommands(pi, permissionManager);

  // ── tool_call: 18-level policy chain + plan mode restrictions ──
  pi.on("tool_call", async (event, ctx) => {
    const toolName = event.toolName || "";
    const input = (event.input || event.args || {}) as Record<string, unknown>;
    const filePath = (input.file_path as string) || (input.path as string) || "";
    
    // Plan mode restrictions (checked first, before policy chain)
    if (planManager.shouldBlockTool(toolName, filePath)) {
      ctx.ui.notify(`Tool "${toolName}" is blocked in Plan Mode. Use read-only tools only.`, "warning");
      return { block: true, reason: "Plan Mode: tool not allowed" };
    }
    
    // 18-level permission policy chain
    const result = await permissionManager.evaluate(toolName, input, ctx.cwd || process.cwd(), ctx);
    if (result?.block) {
      ctx.ui.notify(`Blocked: ${result.reason}`, "warning");
      return result;
    }
  });

  // ── Background Task Tools ──
  registerBackgroundTools(pi);

  // ============================================================
  // Shared: Task-aware model resolution
  // ============================================================
  async function resolveModelForTask(
    prompt: string,
    items: string[],
    available: any[],
    defaultModelId: string,
    defaultProvider: string,
    ctx: any
  ): Promise<string> {
    // Detect task type
    const hasImages = items.some((i: string) => /\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff)$/i.test(i));
    const isSimple = /\b(find|list|scan|grep|read|cat|ls|count|check|show|display)\b/.test(prompt);
    const isComplex = /\b(implement|refactor|design|optimize|create|build|write|debug|test|fix|architect|migrate|integrate)\b/.test(prompt);

    // Score each available model
    const scored = available.map((m: any) => {
      let score = 0;
      const id = m.id.toLowerCase();
      const isMultimodal = m.input?.includes("image");
      const isFree = id.endsWith("-free");
      const isLargeContext = (m.contextWindow || 0) >= 100000;

      if (m.provider === defaultProvider) score += 100;

      if (hasImages) {
        if (isMultimodal) score += 200;
        else score -= 100;
      } else if (isSimple) {
        if (isFree) score += 150;
        score += 50;
      } else if (isComplex) {
        if (isLargeContext) score += 100;
        if (!isFree) score += 50;
      } else {
        if (isFree) score += 50;
      }

      if (isFree) score += 30;
      score -= id.length;
      return { model: m, score };
    }).sort((a: any, b: any) => b.score - a.score);

    if (scored.length >= 2 && Math.abs(scored[0].score - scored[1].score) < 20) {
      // Show top candidates as hint, let user type or select
      const top3 = scored.slice(0, 3).map((s: any) => {
        const m = s.model;
        const free = m.id.endsWith("-free") ? " (free)" : "";
        const vision = m.input?.includes("image") ? " [multimodal]" : "";
        return `${m.id}${free}${vision} [${m.provider}]`;
      });
      const hint = `Top: ${top3.join(" | ")}`;
      const defaultModel = scored[0].model.id;
      const input = await ctx.ui.input(`Model? (${hint})`, defaultModel, { timeout: 30000 });
      if (input && input.trim()) {
        // Check if input matches a candidate
        const match = scored.find((s: any) => s.model.id === input.trim());
        if (match) return match.model.id;
        // Otherwise, try to find by partial match
        const partial = available.find((m: any) => m.id.includes(input.trim()));
        if (partial) return partial.id;
        // Return input as-is (user typed a specific model)
        return input.trim();
      }
      return scored[0].model.id;
    } else if (scored.length > 0) {
      return scored[0].model.id;
    } else {
      const fromDefaultProvider = available.find((m: any) => m.id === defaultModelId && m.provider === defaultProvider);
      const fromAny = available.find((m: any) => m.id === defaultModelId);
      return (fromDefaultProvider || fromAny || available[0])?.id || "";
    }
  }

  // ============================================================
  // agent_swarm - Batch parallel with template
  // ============================================================
  pi.registerTool({
    name: "agent_swarm",
    label: "Agent Swarm",
    description:
      "Batch parallel: same template applied to multiple items. Each item gets isolated sub-agent.",
    parameters: Type.Object({
      description: Type.String({ description: "Swarm name for display" }),
      subagent_type: StringEnum(["explore", "plan", "coder"] as const, {
        default: "coder",
      }),
      prompt_template: Type.Optional(Type.String({
        description: "Template with {{item}} placeholder. Required when items is provided.",
      })),
      items: Type.Optional(Type.Array(Type.String(), {
        description: "Items to process. Each item launches one new sub-agent. Max 128.",
      })),
      resume_agent_ids: Type.Optional(
        Type.Record(
          Type.String({ description: "Existing subagent agent_id" }),
          Type.String({ description: "Prompt to resume that subagent" }),
        ),
        { description: "Map of existing subagent agent_id to prompt for resuming. Resumed before new item-based spawns." },
      ),
      model_tier: Type.Optional(
        StringEnum(["cheap", "balanced", "premium", "auto"] as const, {
          default: "auto",
        }),
      ),
      model: Type.Optional(
        Type.String({ description: "Override model for all agents" }),
      ),
      model_map: Type.Optional(
        Type.Record(
          Type.String({ description: "Item index (0-based)" }),
          Type.String({ description: "Model name or alias for this item" }),
        ),
        { description: "Per-item model overrides. Keys are item indices, values are model names/aliases." },
      ),
      max_concurrency: Type.Optional(Type.Number({ default: 8 })),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!shared.swarmEnabled) {
        return {
          content: [{ type: "text", text: "Swarm mode is OFF. Use /swarm on to enable." }],
          details: null,
        };
      }

      const tier: ModelTier = params.model_tier || "auto";
      const maxC = Math.min(params.max_concurrency || 8, 128);
      const defaultModelId = getDefaultModel();
      const defaultProvider = getDefaultProvider();

      // ── Runtime model selection ───────────────────────────────────────────
      const available: Array<{ id: string; provider?: string; cost: { input: number } }> =
        ctx.modelRegistry?.getAvailable() || [];

      // Model alias map: convenience name → actual model ID
      // These are the REAL model IDs from the registry
      // Smart model resolution (fully automatic - no hardcoded aliases)
      let modelId = params.model || "";
      if (modelId) {
        // User specified: auto-discover best match
        const query = modelId.toLowerCase();
        const candidates = available.filter((m: any) => {
          const id = m.id.toLowerCase();
          const name = (m.name || "").toLowerCase();
          const provider = (m.provider || "").toLowerCase();
          return id.includes(query) || name.includes(query) || provider.includes(query);
        });
        if (candidates.length === 0) {
          ctx.ui.notify(`No model matching "${modelId}" found. Available: ${available.map((m: any) => m.id).slice(0, 10).join(", ")}...`, "error");
          return;
        }
        const scored = candidates.map((m: any) => {
          let score = 0;
          if (m.provider === defaultProvider) score += 100;
          if (m.id.endsWith("-free")) score += 50;
          score -= m.id.length;
          return { model: m, score };
        }).sort((a: any, b: any) => b.score - a.score);
        modelId = scored[0].model.id;
      } else {
        // Auto-select based on task type
        modelId = await resolveModelForTask(
          (params.prompt_template || "").toLowerCase(),
          params.items || [],
          available, defaultModelId, defaultProvider, ctx
        );
      }
      if (!modelId) { ctx.ui.notify("No models available in registry.", "error"); return; }
      const selectedModelObj = available.find((m: any) => m.id === modelId);
      const isVision = selectedModelObj?.input?.includes("image");
      if (isVision) {
        console.log(`[swarm] Selected multimodal model: ${modelId} (supports text+image)`);
      }

      // Resolve model_map (auto-discover best matching model)
      const rawMap = params.model_map || {};
      const resolvedMap: Record<string, string> = {};
      function autoResolveModel(query: string): string {
        const q = query.toLowerCase();
        const candidates = available.filter((m: any) => {
          const id = m.id.toLowerCase();
          const name = (m.name || "").toLowerCase();
          return id.includes(q) || name.includes(q);
        });
        if (candidates.length === 0) return query; // fallback to as-is
        const scored = candidates.map((m: any) => {
          let s = 0;
          if (m.provider === defaultProvider) s += 100;
          if (m.id.endsWith("-free")) s += 50;
          s -= m.id.length;
          return { model: m, score: s };
        }).sort((a: any, b: any) => b.score - a.score);
        return scored[0].model.id;
      }
      for (const [k, v] of Object.entries(rawMap)) {
        resolvedMap[k] = autoResolveModel(v as string);
      }

      // Helper: parse provider:model spec
      function parseModelSpec(spec: string): { provider?: string; modelId: string } {
        const colonIdx = spec.indexOf(":");
        if (colonIdx > 0) return { provider: spec.substring(0, colonIdx), modelId: spec.substring(colonIdx + 1) };
        return { modelId: spec };
      }

      // Helper: resolve provider:model spec to actual model ID (without provider prefix)
      function resolveModelSpec(spec: string): string {
        const parsed = parseModelSpec(spec);
        const mId = parsed.modelId;
        const prov = parsed.provider;
        if (prov) {
          // Find model on specific provider
          const found = available.find((m: any) => m.id === mId && m.provider === prov);
          if (found) return found.id; // Return just the model ID, not provider:model
          // If not found on specified provider, try any provider
          const anyProv = available.find((m: any) => m.id === mId);
          return anyProv?.id || mId;
        }
        // No provider specified: prefer default provider, then any
        const fromDefault = available.find((m: any) => m.id === mId && m.provider === defaultProvider);
        const fromAny = available.find((m: any) => m.id === mId);
        return (fromDefault || fromAny)?.id || mId;
      }

            // ── Build tasks ──────────────────────────────────────────────────────
      const tasks: import("./types").SubAgentTask[] = [];

      // Kimi Code-style: resumed subagents first, then item-based spawns
      const resumeIds = (params.resume_agent_ids || {}) as Record<string, string>;
      let taskId = 0;

      for (const [agentId, prompt] of Object.entries(resumeIds)) {
        taskId++;
        const rawModel = resolvedMap[String(taskId)] || modelId;
        const resolvedModel = resolveModelSpec(rawModel);
        tasks.push({
          id: agentId,
          agent: params.subagent_type || 'coder',
          type: params.subagent_type as SubAgentType,
          task: prompt,
          model: resolvedModel,
          status: "pending" as const,
          turns: 0,
          usage: { input: 0, output: 0, cost: 0 },
          outputLines: [],
          progressPercent: 0,
          ticks: 0,
        });
      }

      for (const [i, item] of (params.items || []).entries()) {
        taskId++;
        const rawModel = resolvedMap[String(i)] || resolvedMap[String(i + 1)] || modelId;
        const resolvedModel = resolveModelSpec(rawModel);
        const promptTemplate = params.prompt_template || '';
        tasks.push({
          id: String(taskId).padStart(3, "0"),
          agent: params.subagent_type || 'coder',
          type: params.subagent_type as SubAgentType,
          task: promptTemplate.replace(/\{\{item\}\}/g, item),
          promptTemplate,
          item,
          model: resolvedModel,
          status: "pending" as const,
          turns: 0,
          usage: { input: 0, output: 0, cost: 0 },
          outputLines: [],
          progressPercent: 0,
          ticks: 0,
        });
      }

      // Init swarm state ------------------------------------------------------
      const state: import("./types").SwarmState = {
        name: params.description,
        mode: "swarm",
        modelTier: tier,
        tasks,
        status: "pending",
        startTime: Date.now(),
      };
      setCurrentSwarm(state);
      setActiveSessions(new Map());
      setCancelPending(false);
      setSwarmCancelled(false);
      if (cancelTimer) {
        clearTimeout(cancelTimer);
        setCancelTimer(null);
      }

      // Setup parent abort controller for cancel propagation
      setGlobalAbortController(new AbortController());
      const unlinkGlobal = linkAbortSignal(signal, globalAbortController!);

      const theme = ctx.ui.theme;
      state.status = "running";

      // Widget setup ----------------------------------------------------------
      const tuiRef: { tui: any; lines: string[] } = { tui: null, lines: [] };
      ctx.ui.setWidget("swarm-mode-progress", (_t: any, _th: any) => {
        tuiRef.tui = _t;
        return {
          render: () => {
            const tw = _t?.width ?? 80;
            return tuiRef.lines.map((l: string) => truncateToWidth(l, tw));
          },
          invalidate: () => {},
        };
      });

      const updateWidget = () => {
        const result = buildWidgetLines(state, theme, cancelPending);
        if (result && result.lines.length > 0) {
          tuiRef.lines = result.lines;
        }
      };
      updateWidget();

      // Periodic refresh (braille animation, 80ms tick-driven) ---------------
      let refreshTimer: ReturnType<typeof setInterval> | null = null;
      const startRefresh = () => {
        if (refreshTimer) return;
        refreshTimer = setInterval(() => {
          const result = buildWidgetLines(currentSwarm, theme, cancelPending);
          if (result && result.lines.length > 0) {
            tuiRef.lines = result.lines;
            // Stop when animation finishes
            if (result.refreshInterval <= 0 && refreshTimer) {
              clearInterval(refreshTimer);
              refreshTimer = null;
            }
          } else if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
          }
        }, FRAME_INTERVAL_MS);
      };
      startRefresh();

      // Progress callback -----------------------------------------------------
      const updateProgress = () => {
        updateWidget();
        const d = tasks.filter((t) => t.status === "done").length;
        onUpdate?.({
          content: [
            { type: "text", text: `${state.name}: ${d}/${tasks.length} done` },
          ],
          details: state,
        });
      };

      // Kimi Code-style: progressive launch (initial 5 + 700ms/item)
      try {
        await runProgressive(tasks, 5, 700, async (task) => {
          if (signal.aborted || currentSwarm === null) {
            task.status = "aborted";
            return;
          }
          // Combined signal: tool-level abort OR global /cancel
          const combinedSignal = AbortSignal.any?.(
            [signal, globalAbortController?.signal].filter(Boolean) as AbortSignal[],
          ) ?? signal;
          await runSubAgent(task, ctx, combinedSignal, updateProgress);
        });
      } finally {
        // Clean up global abort controller
        unlinkGlobal();
        setGlobalAbortController(null);
        state.endTime = Date.now();
        state.status = tasks.every((t) => t.status === "done")
          ? "completed"
          : tasks.some((t) => t.status === "done")
            ? "partial"
            : "failed";

        const finalResult = buildWidgetLines(state, theme, false);
        if (finalResult && finalResult.lines.length > 0) {
          tuiRef.lines = finalResult.lines;
        }

        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        setActiveSessions(null);

        // Save for resume if interrupted
        if (state.status === "partial" || state.status === "failed") {
          const completedItems = tasks
            .filter((t) => t.status === "done")
            .map((t) => t.item || t.task);
          setSavedSwarmState({
            name: state.name,
            items: params.items,
            modelTier: tier,
            subagentType: params.subagent_type as SubAgentType,
            promptTemplate: params.prompt_template,
            maxConcurrency: maxC,
            completedItems,
          });
        }

        setTimeout(() => {
          ctx.ui.setWidget("swarm-mode-progress", undefined);
          if (currentSwarm === state) setCurrentSwarm(null);
        }, 5000);
      }

      return {
        content: [{ type: "text", text: formatReport(state) }],
        details: state,
      };
    },

    renderCall(args, theme) {
      let text = `${theme.fg("toolTitle", theme.bold("swarm "))}`;
      text += `${theme.fg("accent", args.description)}`;
      text += ` ${theme.fg("muted", `${args.subagent_type} × ${args.items.length}`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _r, theme) {
      const text = result.content[0];
      return new Text(
        text?.type === "text" ? text.text : "(no output)",
        0,
        0,
      );
    },
  });

  // ============================================================
  // agent - Single dispatch
  // ============================================================
  pi.registerTool({
    name: "agent",
    label: "Agent",
    description:
      "Single agent dispatch: isolated sub-agent for a specific task.",
    parameters: Type.Object({
      prompt: Type.String({ description: "Task prompt" }),
      description: Type.String({ description: "Short description" }),
      subagent_type: StringEnum(["explore", "plan", "coder"] as const, {
        default: "coder",
      }),
      model_tier: Type.Optional(
        StringEnum(["cheap", "balanced", "premium", "auto"] as const, {
          default: "auto",
        }),
      ),
      model: Type.Optional(Type.String()),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const tier: ModelTier = params.model_tier || "auto";
      if (!shared.swarmEnabled) {
        return {
          content: [
            {
              type: "text",
              text: "Swarm mode is OFF. Use /swarm on to enable.",
            },
          ],
          details: null,
        };
      }

      const defaultModelId = getDefaultModel();
      const defaultProvider = getDefaultProvider();
      const available: Array<{ id: string; provider?: string; cost: { input: number } }> =
        ctx.modelRegistry?.getAvailable() || [];


      // Smart model resolution (fully automatic - same as agent_swarm)
      let modelId = params.model || "";
      if (modelId) {
        const query = modelId.toLowerCase();
        const candidates = available.filter((m: any) => {
          const id = m.id.toLowerCase();
          const name = (m.name || "").toLowerCase();
          const provider = (m.provider || "").toLowerCase();
          return id.includes(query) || name.includes(query) || provider.includes(query);
        });
        if (candidates.length === 0) {
          ctx.ui.notify(`No model matching "${modelId}" found.`, "error");
          return;
        }
        const scored = candidates.map((m: any) => {
          let score = 0;
          if (m.provider === defaultProvider) score += 100;
          if (m.id.endsWith("-free")) score += 50;
          score -= m.id.length;
          return { model: m, score };
        }).sort((a: any, b: any) => b.score - a.score);
        modelId = scored[0].model.id;
      } else {
        // Auto-select based on task type
        modelId = await resolveModelForTask(
          (params.prompt || "").toLowerCase(),
          [], // agent tool has no items
          available, defaultModelId, defaultProvider, ctx
        );
      }
      if (!modelId) { ctx.ui.notify("No models available.", "error"); return; }

      // No more scoring code below this point

      const task: import("./types").SubAgentTask = {
        id: "001",
        agent: params.subagent_type,
        type: params.subagent_type as SubAgentType,
        task: params.prompt,
        prompt: params.prompt,
        model: modelId,
        status: "pending" as const,
        turns: 0,
        usage: { input: 0, output: 0, cost: 0 },
        outputLines: [],
        progressPercent: 0,
        ticks: 0,
      };

      const state: import("./types").SwarmState = {
        name: params.description,
        mode: "agent",
        modelTier: tier,
        tasks: [task],
        status: "pending",
        startTime: Date.now(),
      };
      setCurrentSwarm(state);
      setActiveSessions(new Map());
      setSwarmCancelled(false);

      const theme = ctx.ui.theme;
      state.status = "running";

      const tuiRef: { tui: any; lines: string[] } = { tui: null, lines: [] };
      ctx.ui.setWidget("swarm-mode-progress", (_t: any, _th: any) => {
        tuiRef.tui = _t;
        return {
          render: () => {
            const tw = _t?.width ?? 80;
            return tuiRef.lines.map((l: string) => truncateToWidth(l, tw));
          },
          invalidate: () => {},
        };
      });

      const updateWidget = () => {
        const result = buildWidgetLines(state, theme, false);
        if (result && result.lines.length > 0) {
          tuiRef.lines = result.lines;
        }
      };
      updateWidget();

      const update = () => updateWidget();

      try {
        await runSubAgent(task, ctx, signal, update);
      } finally {
        state.endTime = Date.now();
        state.status = task.status === "done" ? "completed" : "failed";

        const finalResult = buildWidgetLines(state, theme, false);
        if (finalResult && finalResult.lines.length > 0) {
          tuiRef.lines = finalResult.lines;
        }

        setActiveSessions(null);

        setTimeout(() => {
          ctx.ui.setWidget("swarm-mode-progress", undefined);
          if (currentSwarm === state) setCurrentSwarm(null);
        }, 5000);
      }

      return {
        content: [{ type: "text", text: formatReport(state) }],
        details: state,
      };
    },

    renderCall(args, theme) {
      let text = `${theme.fg("toolTitle", theme.bold("agent "))}`;
      text += `${theme.fg("accent", args.description)}`;
      text += ` ${theme.fg("muted", args.subagent_type)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _r, theme) {
      const text = result.content[0];
      return new Text(
        text?.type === "text" ? text.text : "(no output)",
        0,
        0,
      );
    },
  });

  // ============================================================
  // Commands
  // ============================================================
  registerCommands(pi);

  // ============================================================
  // Interactive Tools (rpiv-ask-user-question provides ask_user_question)
  // ============================================================
}
