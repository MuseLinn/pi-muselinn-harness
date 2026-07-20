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
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

import type { ModelTier, SubAgentType, SwarmState, SubAgentTask } from "./packages/core/swarm/types";
import { setResumeResult } from "./packages/core/swarm/types";
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
  progressEstimator,
} from "./packages/core/swarm/types";
import { getDefaultModel, getDefaultProvider, runSubAgent, runProgressive, linkAbortSignal } from "./swarm/subagent";
import { SwarmWidgetComponent } from "./swarm/widget";
import { formatReport } from "./packages/core/swarm/report";
import { registerCommands } from "./swarm/commands";
import { goalManager } from "./packages/core/goal";
import type { PersistencePort } from "./packages/core/ports";
import { planManager } from "./packages/core/plan";
import { permissionManager } from "./packages/core/permission";
import { registerPermissionCommands } from "./packages/core/permission/commands";
import { backgroundManager, registerBackgroundTools } from "./task";
import { cronManager, registerCronTools } from "./packages/core/task/cron";
import { registerHooks, hookEngine } from "./packages/core/hooks/index";
import { registerAskUserQuestion, showQuestionDialog } from "./ask/index";
import { registerTodoList, bindTodoSession, clearTodoSession, restoreTodos } from "./todo/index";
import { listDiscoverableSkillFiles } from "./packages/core/skills/index";
import { registerTui, setTuiBadgeProvider } from "./tui/index";
import shared from "./state";

// Interactive question tools (copied from Pi SDK examples)


// Shared: parse provider:model spec (also accepts provider/model slash form)
function parseModelSpec(spec: string): { provider?: string; modelId: string } {
  const colonIdx = spec.indexOf(":");
  if (colonIdx > 0) return { provider: spec.substring(0, colonIdx), modelId: spec.substring(colonIdx + 1) };
  const slashIdx = spec.indexOf("/");
  if (slashIdx > 0) return { provider: spec.substring(0, slashIdx), modelId: spec.substring(slashIdx + 1) };
  return { modelId: spec };
}

// Shared: bounded copy of swarm state for onUpdate details — per-task
// outputLines are replaced by a tail (last 5 lines) plus a total count so
// each progress push stays small. The final tool result keeps the full state.
function summarizeStateForUpdate(state: SwarmState): any {
  return {
    ...state,
    tasks: state.tasks.map((t) => {
      const lines = t.outputLines || [];
      return {
        ...t,
        outputLineCount: lines.length,
        outputLines: lines.length > 5
          ? [`[… ${lines.length - 5} earlier line(s) omitted]`, ...lines.slice(-5)]
          : lines,
      };
    }),
  };
}

// ============================================================
// Background swarm runner — fire-and-forget execution wired to the
// background task manager (task_list / task_output / task_stop).
// ============================================================
async function runSwarmInBackground(
  bgId: string,
  state: SwarmState,
  tasks: SubAgentTask[],
  ctx: any,
  maxC: number,
  outputPath?: string,
): Promise<void> {
  const controller = new AbortController();
  // task_stop flips the entry status to "aborted"; poll and translate that
  // into an abort so in-flight subagents and the worker pool wind down.
  const stopPoll = setInterval(() => {
    const t = backgroundManager.get(bgId);
    if (!t || t.status !== "running") {
      try { controller.abort(); } catch { /* ignore */ }
    }
  }, 500);
  try {
    await runProgressive(tasks, maxC, async (task) => {
      if (controller.signal.aborted) {
        task.status = "aborted";
        return;
      }
      await runSubAgent(task, ctx, controller.signal, () => {
        const d = tasks.filter((t) => t.status === "done").length;
        backgroundManager.appendOutput(bgId, [`progress: ${d}/${tasks.length} done`]);
      });
    });

    // stop() already flipped the entry to "aborted" — leave it as-is.
    if (controller.signal.aborted) return;

    state.endTime = Date.now();
    state.status = tasks.every((t) => t.status === "done")
      ? "completed"
      : tasks.some((t) => t.status === "done")
        ? "partial"
        : "failed";

    const report = formatReport(state);
    if (outputPath) {
      // Kimi Code-style: full report lands in output_path; the task entry
      // keeps only a pointer + tail so in-memory outputLines stay small.
      try {
        fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
        fs.writeFileSync(outputPath, report, "utf-8");
        backgroundManager.complete(bgId, [
          `[report written to ${outputPath} — use Read with offset/limit to page]`,
          ...report.split("\n").slice(-5),
        ]);
      } catch (e: any) {
        backgroundManager.complete(bgId, [`[failed to write output_path ${outputPath}: ${e?.message || e}]`, report]);
      }
    } else {
      backgroundManager.complete(bgId, report.split("\n"));
    }
  } catch (e: any) {
    backgroundManager.fail(bgId, e?.message || String(e));
  } finally {
    clearInterval(stopPoll);
    if (currentSwarm === state) setCurrentSwarm(null);
  }
}

const GOAL_ENTRY_TYPE = "muselinn_goal";

export default function (pi: ExtensionAPI) {
  // ── Hooks engine: wire all pi events (input/tool_result/agent_settled/
  //    turn_end/session_*) before anything else so hooks observe every event ──
  try { registerHooks(pi); } catch { /* hooks must never break extension load */ }

  // ── Main-session skills: expose Kimi Code-style skills directories
  //    (.kimi-code/skills, ~/.pi/skills — the dirs pi does NOT scan
  //    natively) via resources_discover. listDiscoverableSkillFiles
  //    returns individual SKILL.md files with names already provided by
  //    pi-native dirs filtered out, so no collision diagnostics. ──
  try {
    pi.on("resources_discover", (event: { cwd: string }) => {
      try {
        const skillPaths = listDiscoverableSkillFiles(event.cwd || process.cwd());
        return skillPaths.length > 0 ? { skillPaths } : undefined;
      } catch {
        return undefined;
      }
    });
  } catch { /* older pi without resources_discover — subagent path still works */ }

  // ── Goal persistence: save on every change ──
  // Note: pi/ctx go stale after session replacement (newSession/fork/reload
  // or process teardown in pi -p). Persistence callbacks may fire from
  // timers/background completions after that, so guard every appendEntry.
  // Reads always resolve through the freshest ctx we've seen.
  let latestCtx: any = null;
  const persistencePort: PersistencePort = {
    append: (entryType, data) => {
      try { pi.appendEntry(entryType, data); } catch { /* stale ctx */ }
    },
    entries: () => {
      try { return latestCtx?.sessionManager?.getEntries?.() ?? []; } catch { return []; }
    },
  };
  goalManager.bindPersistence(persistencePort);

  // ── Plan mode: inject plan context + tool restrictions ──
  // Plan state is managed per-session via file in session directory (see plan/commands.ts)

  // ── Permission mode persistence ──
  permissionManager.setPersistence((mode) => {
    try { pi.appendEntry("muselinn_permission", { mode }); } catch { /* stale ctx */ }
  });

  // ── Permission approval dialog: numbered three-way ask (shared with
  // ask_user_question). 'once' approves without recording; 'always' records
  // for the session (the old confirm's implicit behavior); 'deny' blocks.
  permissionManager.setApprovalDialog(async (dialogCtx, title, message) => {
    const choice = await showQuestionDialog(dialogCtx, {
      question: `${title}\n${message}`,
      options: [
        { label: "Allow once", description: "Approve this call only" },
        { label: "Always allow (this session)", description: "Record approval for the rest of the session" },
        { label: "Deny", description: "Block this call" },
      ],
    });
    if (choice === "Allow once") return "once";
    if (choice === "Always allow (this session)") return "always";
    return "deny";
  });

  // ── Background task manager binding ──
  backgroundManager.bind(
    (type, data) => { try { pi.appendEntry(type, data); } catch { /* stale ctx */ } },
    (msg, type) => { /* notifications handled via appendEntry */ },
  );

  // ── session_start: restore goal + plan from persisted entries + set status bar ──
  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    // Set plan session directory (for plan file storage)
    try { planManager.setSessionDir(ctx.sessionManager.getSessionDir()); } catch { /* ok */ }

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
    // Running agents count (Kimi Code-style: [3 agents running])
    const agentCount = activeSessions?.size ?? 0;
    ctx.ui.setStatus("agent-count", agentCount > 0
      ? ctx.ui.theme.fg("accent", `[${agentCount} agents running]`)
      : undefined
    );
    // Running background tasks count (Kimi Code-style: [2 tasks running])
    const runningTasks = backgroundManager.list().filter(t => t.status === "running").length;
    ctx.ui.setStatus("task-count", runningTasks > 0
      ? ctx.ui.theme.fg("accent", `[${runningTasks} tasks running]`)
      : undefined
    );
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

    // Restore the todo panel (before binding so the first refresh shows it)
    try { restoreTodos(ctx.sessionManager.getEntries()); } catch { /* ok */ }
    bindTodoSession(ctx, (type, data) => { try { pi.appendEntry(type, data); } catch { /* stale ctx */ } });

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

    // Restore background tasks from persisted entries. Pass the raw entry
    // list: restore() understands both the legacy full-array entry type and
    // the incremental per-task entry type (later entries win per task id).
    try {
      backgroundManager.restore(ctx.sessionManager.getEntries());
    } catch { /* not critical */ }

    // Restore cron tasks from persisted entries (cronManager scans for its own entry type)
    try {
      cronManager.restore(ctx.sessionManager.getEntries());
    } catch { /* not critical */ }

    // Restore permission mode from persisted entries
    try {
      const entries = ctx.sessionManager.getEntries();
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i] as any;
        if (e.type === "custom" && e.customType === "muselinn_permission" && e.data?.mode) {
          if (["auto", "yolo", "manual"].includes(e.data.mode)) {
            permissionManager.setMode(e.data.mode);
            const restoredMode = e.data.mode;
            ctx.ui.setStatus("permission-mode", ctx.ui.theme.fg(
              restoredMode === 'auto' ? 'success' : restoredMode === 'yolo' ? 'warning' : 'accent',
              restoredMode
            ));
          }
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
    permissionManager.injectIntoMessages(event.messages);
  });

  // ── Helper: update goal status bar ──
  function updateGoalStatusBar(ctx: any) {
    latestCtx = ctx;
    goalManager.tryRestoreFromEntries(Array.from(persistencePort.entries()));
    const badge = goalManager.buildFooterBadge();
    if (badge) {
      const color = goalManager.getFooterBadgeColor();
      ctx.ui.setStatus("goal", ctx.ui.theme.fg(color, badge));
    } else {
      ctx.ui.setStatus("goal", undefined);
    }

    // Running agents count (Kimi Code-style)
    const agentCount = activeSessions?.size ?? 0;
    ctx.ui.setStatus("agent-count", agentCount > 0
      ? ctx.ui.theme.fg("accent", `[${agentCount} agents running]`)
      : undefined
    );
    
    // Running background tasks count (Kimi Code-style)
    const runningTasks = backgroundManager.list().filter(t => t.status === "running").length;
    ctx.ui.setStatus("task-count", runningTasks > 0
      ? ctx.ui.theme.fg("accent", `[${runningTasks} tasks running]`)
      : undefined
    );
  }

  // ── Goal badge wall-clock: 1s tick while a goal is active ──
  // The badge shows live duration (Kimi Code footer parity); between turn
  // events it would otherwise go stale. Extra renders are coalesced by
  // pi-tui's 16ms cap; unref'd so `pi -p` is never kept alive by it.
  const goalBadgeTicker = setInterval(() => {
    if (!latestCtx) return;
    const g = goalManager.getGoal();
    if (!g || g.status !== "active") return;
    try { updateGoalStatusBar(latestCtx); } catch { /* stale ctx */ }
  }, 1000);
  goalBadgeTicker.unref?.();

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
  registerAskUserQuestion(pi);
  registerTodoList(pi);
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

    // Hooks: PreToolUse — Kimi Code runs hooks before permission checks.
    try {
      const hookResult = await hookEngine.fire(
        "PreToolUse",
        { tool_name: toolName, tool_input: input, tool_call_id: (event as any).toolCallId },
        { blockable: true, matcherText: toolName, cwd: ctx?.cwd },
      );
      if (hookResult.blocked) {
        const reason = hookResult.reasons.join("; ") || "Blocked by hook";
        try { ctx.ui.notify(`Blocked by hook: ${reason}`, "warning"); } catch { /* ok */ }
        return { block: true, reason };
      }
    } catch { /* hook failures fail open */ }

    const filePath = (input.file_path as string) || (input.path as string) || "";
    // Bash command string — forwarded to plan-mode gate so the read-only
    // whitelist in PlanManager.shouldBlockTool can vet it. Other tools ignore
    // this 3rd (optional) arg.
    const bashCommand = (input.command as string) || (input.cmd as string) || (input.script as string) || "";

    // Plan mode restrictions (checked first, before policy chain)
    if (planManager.shouldBlockTool(toolName, filePath, bashCommand)) {
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

  // ── Cron Tools (scheduled prompts) ──
  registerCronTools(pi);

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
    const needsVision = hasImages || /\b(vi(?:sual|deo|sion)|image|screen(?:shot|cap)|photo|multimod|[多视]模态|视觉|图像|截图|图片|照[片面]|视频|GIF|pixel|render|asset|sprite|texture|特效|光影|色彩|动画|UI.*check|界面.*检|[检审]查.*(?:视觉|画面|效果))\b/i.test(prompt);
    const isSimple = /\b(find|list|scan|grep|read|cat|ls|count|check|show|display)\b/.test(prompt);
    const isComplex = /\b(implement|refactor|design|optimize|create|build|write|debug|test|fix|architect|migrate|integrate)\b/.test(prompt);

    // Get the current session's active model (prefer it, as the user is already using it)
    const currentModelId = ctx.model?.id ?? "";
    const currentProvider = ctx.model?.provider ?? defaultProvider;

    // Score each available model
    const scored = available.map((m: any) => {
      let score = 0;
      const id = m.id.toLowerCase();
      const isMultimodal = m.input?.includes("image");
      const isFree = id.endsWith("-free");
      const isLargeContext = (m.contextWindow || 0) >= 100000;
      const costPerMee = (m.cost?.input || 0) + (m.cost?.output || 0);

      if (m.provider === defaultProvider) score += 100;

      // Prefer the same provider as the current session
      if (currentProvider && m.provider === currentProvider) score += 80;

      // Prefer the current session's active model (user is already using it)
      if (currentModelId && m.id === currentModelId) score += 200;

      // Cost-aware: penalize expensive models unless task really needs them
      // Free models get a big boost; expensive ones need strong justification
      if (isFree) score += 50;
      else if (costPerMee > 10) score -= 60;  // >$10/M tokens
      else if (costPerMee > 5) score -= 30;   // >$5/M tokens
      else if (costPerMee > 2) score -= 10;   // >$2/M tokens

      // Multimodal routing: only prefer multimodal when task needs vision
      if (needsVision) {
        if (isMultimodal) score += 200;  // Strong preference for multimodal
        else score -= 150;               // Penalize text-only for vision tasks
      } else if (hasImages) {
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
      // Show top candidates as structured selection list
      const modelOptions = scored.slice(0, 5).map((s: any) => {
        const m = s.model;
        const free = m.id.endsWith("-free") ? " (free)" : "";
        const vision = m.input?.includes("image") ? " [multimodal]" : "";
        const context = m.contextWindow ? ` ${Math.round(m.contextWindow/1000)}k ctx` : "";
        return `${m.id}${free}${vision}${context} [${m.provider}]`;
      });
      modelOptions.push("Other (type a model name)");

      const choice = await ctx.ui.select(
        `Which model? (default: ${scored[0].model.id})`,
        modelOptions,
        { timeout: 30000 }
      );

      if (choice === "Other (type a model name)") {
        const custom = await ctx.ui.input("Enter model name:", scored[0].model.id, { timeout: 30000 });
        if (custom?.trim()) {
          const exact = scored.find((s: any) => s.model.id === custom.trim());
          if (exact) return `${exact.model.provider}:${exact.model.id}`;
          const partial = available.find((m: any) => m.id.includes(custom.trim()));
          if (partial) return `${partial.provider}:${partial.id}`;
          return custom.trim();
        }
      } else if (choice) {
        const idx = modelOptions.indexOf(choice);
        if (idx >= 0 && idx < scored.length) return `${scored[idx].model.provider}:${scored[idx].model.id}`;
      }
      return `${scored[0].model.provider}:${scored[0].model.id}`;
    } else if (scored.length > 0) {
      return `${scored[0].model.provider}:${scored[0].model.id}`;
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
    promptSnippet: "agent_swarm — auto-routes models based on task type unless specified",
    promptGuidelines: [
      "Model routing is automatic: if you don't specify 'model', the system picks the best model based on task type, current session model, and available capabilities.",
      "If the user mentions specific models (e.g., 'use deepseek' or '用mimo'), pass them through the 'model' or 'model_map' parameter.",
      "For multi-model swarms, use model_map to assign different models per item (e.g., \"0\": \"opencode-go:deepseek-v4-flash\", \"1\": \"xiaomi:mimo-v2.5\").",
      "When uncertain which model is best, call ask_user_question to let the user choose — then pass their response as model/model_map.",
      "For image/multimodal tasks, the system automatically prefers multimodal-capable models.",
    ],
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
      max_concurrency: Type.Optional(Type.Number({ default: 5 })),
      run_in_background: Type.Optional(
        Type.Boolean({
          default: false,
          description:
            "Run the swarm as a background task and return a task ID immediately. Results are collected via task_list/task_output; final report optionally lands in output_path.",
        }),
      ),
      output_path: Type.Optional(
        Type.String({
          description: "Only with run_in_background: write the final swarm report to this file (page through it with Read offset/limit).",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (!shared.swarmEnabled) {
        return {
          content: [{ type: "text", text: "Swarm mode is OFF. Use /swarm on to enable." }],
          details: null,
        };
      }

      const tier: ModelTier = params.model_tier || "auto";
      const maxC = Math.min(params.max_concurrency || 5, 128);
      const runInBackground = params.run_in_background === true;
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
        // User specified: support provider:model / provider/model, then fuzzy match
        const parsed = parseModelSpec(modelId);
        let candidates: any[];
        if (parsed.provider) {
          candidates = available.filter((m: any) =>
            m.id.toLowerCase() === parsed.modelId.toLowerCase() &&
            m.provider?.toLowerCase() === parsed.provider.toLowerCase()
          );
          if (candidates.length === 0) {
            candidates = available.filter((m: any) =>
              m.id.toLowerCase() === parsed.modelId.toLowerCase()
            );
          }
        } else {
          const query = modelId.toLowerCase();
          candidates = available.filter((m: any) => {
            const id = m.id.toLowerCase();
            const name = (m.name || "").toLowerCase();
            const provider = (m.provider || "").toLowerCase();
            return id.includes(query) || name.includes(query) || provider.includes(query);
          });
        }
        if (candidates.length === 0) {
          // Never return undefined — pi reads result.content and crashes.
          return { content: [{ type: "text", text: `No model matching "${modelId}" found. Available: ${available.map((m: any) => m.id).slice(0, 10).join(", ")}...` }] };
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
      if (!modelId) {
        return { content: [{ type: "text", text: "No models available in registry." }] };
      }
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

      // Helper: resolve provider:model spec to actual model ID
      function resolveModelSpec(spec: string): string {
        const parsed = parseModelSpec(spec);
        const mId = parsed.modelId;
        const prov = parsed.provider;
        if (prov) {
          // Find model on specific provider
          const found = available.find((m: any) => m.id === mId && m.provider === prov);
          if (found) return `${found.provider}:${found.id}`;
          // If not found on specified provider, try any provider
          const anyProv = available.find((m: any) => m.id === mId);
          return anyProv ? `${anyProv.provider}:${anyProv.id}` : mId;
        }
        // No provider specified: prefer default provider, then any
        const fromDefault = available.find((m: any) => m.id === mId && m.provider === defaultProvider);
        const fromAny = available.find((m: any) => m.id === mId);
        const found = fromDefault || fromAny;
        return found ? `${found.provider}:${found.id}` : mId;
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
          toolCalls: 0,
          estimatedTotalCalls: 10,
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
          toolCalls: 0,
          estimatedTotalCalls: 10,
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
      progressEstimator.reset();
      for (const t of tasks) progressEstimator.ensureMember(t.id);
      setActiveSessions(new Map());
      setCancelPending(false);
      setSwarmCancelled(false);
      if (cancelTimer) {
        clearTimeout(cancelTimer);
        setCancelTimer(null);
      }

      // ── Background mode: hand off to the background task manager ──
      if (runInBackground) {
        const bgId = `bg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        backgroundManager.register({
          id: bgId,
          prompt: `[swarm] ${params.description} (${tasks.length} agents)`,
          model: modelId,
          subagentType: params.subagent_type || "coder",
          status: "running",
          outputLines: [],
          startTime: Date.now(),
          createdAt: Date.now(),
          turns: 0,
          usage: { input: 0, output: 0, cost: 0 },
        });
        const outputPath = params.output_path as string | undefined;
        state.status = "running";
        // Fire-and-forget: progress lands in the task entry, the final
        // report in the entry (and optionally in output_path).
        void runSwarmInBackground(bgId, state, tasks, ctx, maxC, outputPath);
        return {
          content: [{
            type: "text",
            text:
              `Swarm started in background. Task ID: ${bgId}\n` +
              `${tasks.length} agents queued (max_concurrency=${maxC}, 30min/agent timeout).\n` +
              `Use task_list to check status, task_output(task_id="${bgId}", block=true) to wait for completion.` +
              (outputPath ? `\nFinal report will be written to: ${outputPath}` : ""),
          }],
          details: null,
        };
      }

      // Setup parent abort controller for cancel propagation
      setGlobalAbortController(new AbortController());
      const unlinkGlobal = linkAbortSignal(signal, globalAbortController!);

      const theme = ctx.ui.theme;
      state.status = "running";

      // Widget setup ----------------------------------------------------------
      // pi-tui Component (same Container-based protocol as the /tasks
      // browser). pi mounts it via setWidget and calls render(width) with the
      // real viewport width; all line building is fingerprint-gated inside
      // widget.update().
      const widget = new SwarmWidgetComponent(() => currentSwarm, theme, () => cancelPending);
      let widgetTui: any = null;
      ctx.ui.setWidget("swarm-mode-progress", (t: any, _th: any) => {
        widgetTui = t;
        return widget;
      });
      const repaintWidget = () => {
        widgetTui?.invalidate?.();
        widgetTui?.requestRender?.();
      };
      const updateWidget = () => {
        if (widget.update() === "changed") repaintWidget();
      };
      updateWidget();

      // Periodic refresh at FRAME_INTERVAL_MS (250ms) — drives the braille
      // fill animation and status-line spinner. The fingerprint gate inside
      // widget.update() skips the rebuild + repaint on frames where nothing
      // visible changed, and the timer stops itself once the build reports
      // refreshIntervalMs === 0 (animation settled).
      let refreshTimer: ReturnType<typeof setInterval> | null = null;
      const startRefresh = () => {
        if (refreshTimer) return;
        refreshTimer = setInterval(() => {
          const status = widget.update();
          if (status === "changed") repaintWidget();
          // Stop when the swarm is gone or the animation has settled.
          if ((status === "empty" || widget.refreshIntervalMs <= 0) && refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
          }
        }, FRAME_INTERVAL_MS);
      };
      startRefresh();

      // Progress callback -----------------------------------------------------
      // details is a truncated summary (per-task outputLines capped to a tail)
      // so per-frame updates pushed to the parent agent stay small; the final
      // tool result below still returns the full state.
      const updateProgress = () => {
        updateWidget();
        const d = tasks.filter((t) => t.status === "done").length;
        onUpdate?.({
          content: [
            { type: "text", text: `${state.name}: ${d}/${tasks.length} done` },
          ],
          details: summarizeStateForUpdate(state),
        });
      };

      // Kimi Code-style: progressive launch (initial batch + 700ms spacing),
      // bounded by max_concurrency via the worker pool in runProgressive.
      try {
        await runProgressive(tasks, maxC, async (task) => {
          if (signal.aborted || currentSwarm === null) {
            task.status = "aborted";
            return;
          }
          // Combined signal: tool-level abort OR global /cancel
          const combinedSignal = AbortSignal.any?.(
            [signal, globalAbortController?.signal].filter(Boolean) as AbortSignal[],
          ) ?? signal;
          await runSubAgent(task, ctx, combinedSignal, updateProgress);
        }, { initialBatch: Math.min(5, maxC), spacingMs: 700 });
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

        // Final one-shot repaint (fingerprint-gated like everything else);
        // after this the timer is stopped and nothing re-renders the widget.
        if (widget.update() === "changed") repaintWidget();

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
          // The session may have ended/been replaced before this deferred
          // cleanup fires (e.g. pi -p exits right after the report). Any
          // access to a stale ctx throws — the widget is gone with the old
          // session anyway, so just bail out.
          try {
            ctx.ui.setWidget("swarm-mode-progress", undefined);
          } catch { /* stale ctx */ }
          if (currentSwarm === state) setCurrentSwarm(null);
        }, 30000);
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
      const state = result.details as any;
      if (!state || !state.tasks) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text.slice(0, 100) : "(no output)", 0, 0);
      }

      const total = state.tasks.length;
      const done = state.tasks.filter((t: any) => t.status === "done").length;
      const failed = state.tasks.filter((t: any) => t.status === "failed").length;
      const aborted = state.tasks.filter((t: any) => t.status === "aborted").length;

      let icon: string;
      if (failed > 0) icon = theme.fg("error", "\u2717");
      else if (aborted > 0) icon = theme.fg("warning", "\u26A0");
      else icon = theme.fg("success", "\u2713");

      const label = failed > 0 ? `${done}/${total} completed, ${failed} failed` : aborted > 0 ? `${done}/${total} completed, ${aborted} aborted` : `${done}/${total} completed`;
      return new Text(
        `${icon} ${theme.fg("text", "Agent swarm:")} ${theme.fg(failed > 0 ? "error" : "success", label)}`,
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
    promptSnippet: "agent — single sub-agent with auto model routing",
    promptGuidelines: [
      "Model routing is automatic: if you don't specify 'model', the system picks the best model based on task type, current session model, and available capabilities.",
      "If the user mentions a specific model name, pass it via the 'model' parameter.",
      "When uncertain which model to use, call ask_user_question to let the user choose.",
    ],
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
        // Parse provider:model format first
        const parsed = parseModelSpec(modelId);
        let candidates: any[];
        if (parsed.provider) {
          // Exact provider + model ID match
          candidates = available.filter((m: any) =>
            m.id.toLowerCase() === parsed.modelId.toLowerCase() &&
            m.provider?.toLowerCase() === parsed.provider.toLowerCase()
          );
          // Fallback: any provider with this model ID
          if (candidates.length === 0) {
            candidates = available.filter((m: any) =>
              m.id.toLowerCase() === parsed.modelId.toLowerCase()
            );
          }
        } else {
          // No provider specified: text search across id/name/provider
          const query = modelId.toLowerCase();
          candidates = available.filter((m: any) => {
            const id = m.id.toLowerCase();
            const name = (m.name || "").toLowerCase();
            const provider = (m.provider || "").toLowerCase();
            return id.includes(query) || name.includes(query) || provider.includes(query);
          });
        }
        if (candidates.length === 0) {
          // Never return undefined — pi reads result.content and crashes.
          return { content: [{ type: "text", text: `No model matching "${modelId}" found.` }] };
        }
        const scored = candidates.map((m: any) => {
          let score = 0;
          if (m.provider === defaultProvider) score += 100;
          if (m.id.endsWith("-free")) score += 50;
          score -= m.id.length;
          return { model: m, score };
        }).sort((a: any, b: any) => b.score - a.score);
        modelId = `${scored[0].model.provider}:${scored[0].model.id}`;
      } else {
        // Auto-select based on task type
        modelId = await resolveModelForTask(
          (params.prompt || "").toLowerCase(),
          [], // agent tool has no items
          available, defaultModelId, defaultProvider, ctx
        );
      }
      if (!modelId) {
        return { content: [{ type: "text", text: "No models available." }] };
      }

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
      progressEstimator.reset();
      progressEstimator.ensureMember("001");
      setActiveSessions(new Map());
      setSwarmCancelled(false);

      const theme = ctx.ui.theme;
      state.status = "running";

      // pi-tui Component (same protocol as agent_swarm's widget above).
      const widget = new SwarmWidgetComponent(() => state, theme, () => false);
      let widgetTui: any = null;
      ctx.ui.setWidget("swarm-mode-progress", (t: any, _th: any) => {
        widgetTui = t;
        return widget;
      });
      const repaintWidget = () => {
        widgetTui?.invalidate?.();
        widgetTui?.requestRender?.();
      };
      const updateWidget = () => {
        if (widget.update() === "changed") repaintWidget();
      };
      updateWidget();

      // Periodic refresh at FRAME_INTERVAL_MS (250ms) — same fingerprint
      // gate and settle-stop logic as agent_swarm.
      let refreshTimer: ReturnType<typeof setInterval> | null = null;
      const startRefresh = () => {
        if (refreshTimer) return;
        refreshTimer = setInterval(() => {
          const status = widget.update();
          if (status === "changed") repaintWidget();
          if ((status === "empty" || widget.refreshIntervalMs <= 0) && refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
          }
        }, FRAME_INTERVAL_MS);
      };
      startRefresh();

      const update = () => updateWidget();

      try {
        await runSubAgent(task, ctx, signal, update);
      } finally {
        // Clean up refresh timer
        if (refreshTimer) {
          clearInterval(refreshTimer);
          refreshTimer = null;
        }
        state.endTime = Date.now();
        state.status = task.status === "done" ? "completed" : "failed";

        // Final one-shot repaint; nothing re-renders the widget afterwards.
        if (widget.update() === "changed") repaintWidget();

        setActiveSessions(null);

        setTimeout(() => {
          // Same stale-ctx guard as agent_swarm: the session may be gone by
          // the time this deferred cleanup fires.
          try {
            ctx.ui.setWidget("swarm-mode-progress", undefined);
          } catch { /* stale ctx */ }
          if (currentSwarm === state) setCurrentSwarm(null);
        }, 30000);
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
      const state = result.details as any;
      if (!state || !state.tasks || state.tasks.length === 0) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text.slice(0, 100) : "(no output)", 0, 0);
      }

      const task = state.tasks[0];
      const icon = task.status === "done" ? theme.fg("success", "\u2713") :
                   task.status === "failed" ? theme.fg("error", "\u2717") :
                   task.status === "aborted" ? theme.fg("warning", "\u26A0") : theme.fg("muted", "○");
      const label = task.status === "done" ? "Completed" :
                    task.status === "failed" ? `Failed: ${(task.error || "").slice(0, 40)}` :
                    task.status === "aborted" ? "Aborted" : "Running...";
      return new Text(
        `${icon} ${theme.fg("text", "Agent:")} ${theme.fg(task.status === "done" ? "success" : "error", label)}`,
        0,
        0,
      );
    },
  });

  // ============================================================
  // Commands
  // ============================================================
  registerCommands(pi);

  // ── TUI: boxed/compact editor chrome + /tui ──
  try { registerTui(pi); } catch { /* TUI chrome must never break extension load */ }

  // Plan-mode badge on the editor's top border (lazy, cheap in-memory
  // check; reads planManager's state without coupling tui → plan).
  try {
    setTuiBadgeProvider(() => (planManager.isPlanModeActive() ? " plan " : undefined));
  } catch { /* badge is cosmetic */ }

  // ============================================================
  // Interactive Tools (rpiv-ask-user-question provides ask_user_question)
  // ============================================================
}
