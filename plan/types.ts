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
export let currentPlanMode: PlanModeState = {
  isActive: false,
  currentPlan: null,
  history: [],
};

export function setCurrentPlanMode(state: PlanModeState): void {
  currentPlanMode = state;
}

export function setCurrentPlan(plan: PlanData | null): void {
  currentPlanMode.currentPlan = plan;
}

export function setPlanActive(active: boolean): void {
  currentPlanMode.isActive = active;
}
