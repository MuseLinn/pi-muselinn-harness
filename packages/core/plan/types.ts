// ============================================================
// Plan Types — Kimi Code-style Plan Mode
// ============================================================

export type PlanStatus = 'inactive' | 'exploring' | 'writing' | 'reviewing' | 'approved' | 'rejected';

export interface PlanData {
  id: string;
  content: string;
  path: string;
  status: PlanStatus;
  createdAt: number;
  updatedAt?: number;
  approvedAt?: number;
  rejectedAt?: number;
  rejectionReason?: string;
  /** User's revision feedback collected during Revise flow */
  revisionFeedback?: string;
}

export interface PlanModeState {
  isActive: boolean;
  currentPlan: PlanData | null;
  history: PlanData[];
}

// Tools allowed in Plan Mode (read-only + plan file)
export const PLAN_MODE_ALLOWED_TOOLS = [
  'read',
  'grep',
  'find',
  'ls',
  'bash',  // For read-only commands
  'write', // Only for plan file
  'edit',  // Only for plan file
] as const;

// Tools blocked in Plan Mode
export const PLAN_MODE_BLOCKED_TOOLS = [
  'edit',  // Blocked for non-plan files
  'write', // Blocked for non-plan files
] as const;

// Plan file path pattern
export const PLAN_FILE_PATTERN = 'plans/{id}.md';

// Global state (in-memory only; real persistence via appendEntry in commands)
//
// NOTE: `export const` container + property-level mutation, never a reassigned
// `export let`. pi's jiti loader (2.7.0) snapshots cross-module `export let`
// bindings, so a setter in this module would not be visible to consumers that
// imported the binding before the write. Mutating properties of a shared
// container keeps every importer looking at the same live object.
export const planModeState: PlanModeState = {
  isActive: false,
  currentPlan: null,
  history: [],
};

export function setCurrentPlanMode(state: PlanModeState): void {
  planModeState.isActive = state.isActive;
  planModeState.currentPlan = state.currentPlan;
  planModeState.history = state.history;
}

export function setCurrentPlan(plan: PlanData | null): void {
  planModeState.currentPlan = plan;
}

export function setPlanActive(active: boolean): void {
  planModeState.isActive = active;
}
