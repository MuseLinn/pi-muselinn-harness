// ============================================================
// Swarm Module — Kimi Code-style Agent Swarm
// ============================================================

export { UserCancellationError, userCancellationReason, isUserCancellation, runSubAgent, runProgressive, linkAbortSignal, getDefaultModel, getDefaultProvider } from "./subagent";
export { buildWidgetLines } from "./widget";
export { formatReport } from "./report";
export { TasksBrowserComponent } from "./task-browser";
export { fmtDuration, fmtTokens, fmtCost, calculateGridLayout, accumulatedBrailleBar, incrementTicks, computeDisplayTicks, visibleWidth } from "./helpers";

// Re-export types
export type { SwarmState, SubAgentTask, SubAgentType, ModelTier, AgentStatus, GridLayout } from "./types";
export { currentSwarm, setCurrentSwarm, BRAILLE_LEVELS, BRAILLE_EMPTY, BRAILLE_BAR_FILLED, CELL_GAP, TEXT_CELL_PREFERRED_WIDTH, BRAILLE_BAR_MAX_WIDTH, BRAILLE_BAR_MIN_WIDTH, MIN_LABEL_WIDTH, STATUS_BAR_PHASES, STATUS_BAR_CHAR, AGENT_SWARM_LEFT_INDENT, COMPLETE_FILL_MS, FRAME_INTERVAL_MS } from "./types";
