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

// File-based state persistence (survives Pi module hot-reload)
import * as fs from 'node:fs';
import * as path from 'node:path';

const STATE_FILE = path.join(
  process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH || '.',
  '.pi', 'agent', 'extensions', 'pi-muselinn-harness', '.plan-state.json'
);

function loadState(): PlanModeState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch { /* ignore */ }
  return { isActive: false, currentPlan: null, history: [] };
}

function saveState(state: PlanModeState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  } catch { /* ignore */ }
}

export let currentPlanMode: PlanModeState = loadState();

export function setCurrentPlanMode(state: PlanModeState): void {
  currentPlanMode = state;
  saveState(state);
}

export function setCurrentPlan(plan: PlanData | null): void {
  currentPlanMode.currentPlan = plan;
  saveState(currentPlanMode);
}

export function setPlanActive(active: boolean): void {
  currentPlanMode.isActive = active;
  saveState(currentPlanMode);
}
