// ============================================================
// Swarm Mode — Types & Global State
// ============================================================

export type SubAgentType = "coder" | "explore" | "plan";
export type ModelTier = "cheap" | "balanced" | "premium" | "auto";
export type AgentStatus = "pending" | "running" | "done" | "failed" | "aborted";

export interface TaskUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SubAgentTask {
  id: string;
  agent: string;
  type: SubAgentType;
  task: string;
  promptTemplate?: string;
  item?: string;
  /** For single-agent dispatch, store the original prompt */
  prompt?: string;
  model: string;
  status: AgentStatus;
  startTime?: number;
  endTime?: number;
  turns: number;
  usage: { input: number; output: number; cost: number };
  currentAction?: string;
  outputLines: string[];       // 完整输出文本行（实时累积 + 完成后补充）
  progressPercent: number;
  /** Real tool calls completed (drives braille bar) */
  toolCalls: number;
  /** Estimated total tool calls for this agent */
  estimatedTotalCalls: number;
  /** Tick counter for braille bar animation — incremented each frame */
  ticks: number;
  /** Timestamp when task completed (ms) — drives fill animation */
  completedAtMs?: number;
  error?: string;
}

export interface SwarmState {
  name: string;
  mode: "swarm" | "agent";
  modelTier: ModelTier;
  tasks: SubAgentTask[];
  status: "pending" | "running" | "completed" | "partial" | "failed";
  startTime: number;
  endTime?: number;
}

export interface SavedSwarm {
  name: string;
  items: string[];
  modelTier: ModelTier;
  subagentType: SubAgentType;
  promptTemplate: string;
  maxConcurrency: number;
  completedItems: string[];
  resumeIds?: Record<string, string>;  // Kimi Code-style resumed subagents
}

export interface GridLayout {
  columns: number;
  rows: number;
  cellWidth: number;
  barCells: number;
}

// ============================================================
// Braille & Layout Constants
// ============================================================

export const BRAILLE_LEVELS = ["⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿"] as const;
export const BRAILLE_EMPTY = "⣀";
export const BRAILLE_BAR_FILLED = "⣿";
export const BRAILLE_RIGHT_COLUMN_FULL = "⢸";
export const CELL_GAP = "  ";
export const TEXT_CELL_PREFERRED_WIDTH = 30;
export const BRAILLE_BAR_MAX_WIDTH = 8;
export const BRAILLE_BAR_MIN_WIDTH = 4;
export const MIN_LABEL_WIDTH = 5;
export const STATUS_BAR_PHASES = ["completed", "working", "queued", "failed"] as const;
export const STATUS_BAR_CHAR = "━";
export const AGENT_SWARM_LEFT_INDENT = " ";
export const COMPLETE_FILL_MS = 360;
export const FRAME_INTERVAL_MS = 250;

// Output accumulation bounds (Phase 3): once a subagent's streamed output
// exceeds the byte gate, appends stop and a single truncation marker is kept;
// the lines array itself is capped, dropping the oldest lines.
export const MAX_OUTPUT_LINES = 1000;
export const OUTPUT_TRUNCATED_MARKER = "[output truncated]";

// ============================================================
// Goal Types — re-export from goal/types.ts (single source of truth)
// ============================================================

import type { GoalSnapshot, GoalStatus, GoalActor, GoalBudgetLimits } from "../goal/types.ts";
import { currentGoal, setCurrentGoal } from "../goal/types.ts";

export type { GoalSnapshot, GoalStatus, GoalActor, GoalBudgetLimits };
export { currentGoal, setCurrentGoal };

// ============================================================
// Global State
// ============================================================

import { ProgressEstimator } from "./estimator.ts";

export let currentSwarm: SwarmState | null = null;
export let activeSessions: Map<string, { session: { abort(): Promise<void>; dispose(): void }; taskId: string }> | null = null;
export let cancelPending = false;
export let cancelTimer: ReturnType<typeof setTimeout> | null = null;
export let savedSwarmState: SavedSwarm | null = null;
export let swarmCancelled = false;
export let globalAbortController: AbortController | null = null; // parent cancel → children
export let progressEstimator = new ProgressEstimator(); // Kimi Code-style progress prediction

// Resume tracking: agentId → completed info for resume_agent_ids
const resumeResults = new Map<string, { status: string; output?: string }>();
export function setResumeResult(id: string, r: { status: string; output?: string }): void { resumeResults.set(id, r); }
export function getResumeResults(): Map<string, { status: string; output?: string }> { return resumeResults; }
export function clearResumeResults(): void { resumeResults.clear(); }

export function setCurrentSwarm(s: SwarmState | null): void { currentSwarm = s; }
export function setActiveSessions(m: typeof activeSessions): void { activeSessions = m; }
export function setCancelPending(v: boolean): void { cancelPending = v; }
export function setCancelTimer(t: typeof cancelTimer): void { cancelTimer = t; }
export function setSavedSwarmState(s: typeof savedSwarmState): void { savedSwarmState = s; }
export function setSwarmCancelled(v: boolean): void { swarmCancelled = v; }
export function setGlobalAbortController(c: AbortController | null): void { globalAbortController = c; }
