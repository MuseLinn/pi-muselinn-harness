// ============================================================
// Plan System — Kimi Code-style Plan Mode
// ============================================================

import type { PlanData, PlanStatus, PlanModeState } from "./types";
import { currentPlanMode, setCurrentPlanMode, setCurrentPlan, setPlanActive } from "./types";
import { registerPlanTools } from "./tools";
import { registerPlanCommands } from "./commands";

/**
 * Generate a unique plan ID.
 */
function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================
// PlanManager — lifecycle + persistence + injection
// ============================================================

export class PlanManager {
  private persistFn: ((data: PlanModeState) => void) | null = null;
  private sessionDir: string = '';

  /** Bind a persistence callback */
  setPersistence(fn: (data: PlanModeState) => void): void {
    this.persistFn = fn;
  }

  /** Set session directory for plan file storage */
  setSessionDir(dir: string): void {
    this.sessionDir = dir;
  }

  /** Persist current state */
  private persist(): void {
    if (this.persistFn) this.persistFn(currentPlanMode);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /**
   * Generate Kimi Code-style hero slug (e.g., "psylocke-kamala-khan-falcon").
   */
  private generateHeroSlug(): string {
    const adjectives = ['psylocke', 'wolverine', 'cyclops', 'storm', 'jean', 'beast', 'colossus', 'nightcrawler'];
    const nouns = ['kamala-khan', 'peter-parker', 'tony-stark', 'steve-rogers', 'natasha', 'bruce-banner', 'thor', 'loki'];
    const verbs = ['falcon', 'hawk', 'eagle', 'raven', 'wolf', 'fox', 'bear', 'lion'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const verb = verbs[Math.floor(Math.random() * verbs.length)];
    return `${adj}-${noun}-${verb}`;
  }

  /**
   * Enter Plan Mode (Kimi Code-style).
   * Called by EnterPlanMode tool or /plan command.
   */
  enterPlanMode(reason?: string): PlanData {
    const heroSlug = this.generateHeroSlug();
    const planPath = this.sessionDir
      ? `${this.sessionDir}/plans/${heroSlug}.md`
      : `plans/${heroSlug}.md`;
    const plan: PlanData = {
      id: generatePlanId(),
      content: '',
      path: planPath,
      status: 'exploring',
      createdAt: Date.now(),
    };

    setCurrentPlanMode({
      isActive: true,
      currentPlan: plan,
      history: [...currentPlanMode.history, plan],
    });
    this.persist();

    return plan;
  }

  /**
   * Exit Plan Mode (Kimi Code-style).
   * Called by ExitPlanMode tool.
   */
  exitPlanMode(): PlanData | null {
    const plan = currentPlanMode.currentPlan;
    if (!plan) return null;

    plan.status = 'reviewing';
    setCurrentPlan(plan);
    setPlanActive(false);
    this.persist();

    return plan;
  }

  /**
   * Approve the current plan.
   */
  approvePlan(): PlanData | null {
    const plan = currentPlanMode.currentPlan;
    if (!plan) return null;

    plan.status = 'approved';
    plan.approvedAt = Date.now();
    setCurrentPlan(plan);

    // Exit plan mode
    setPlanActive(false);
    this.persist();

    return plan;
  }

  /**
   * Reject the current plan.
   */
  rejectPlan(reason?: string): PlanData | null {
    const plan = currentPlanMode.currentPlan;
    if (!plan) return null;

    plan.status = 'rejected';
    plan.rejectedAt = Date.now();
    plan.rejectionReason = reason;
    setCurrentPlan(plan);

    // Exit plan mode
    setPlanActive(false);
    this.persist();

    return plan;
  }

  /**
   * Clear plan mode (Kimi Code-style /plan clear).
   */
  clearPlan(): void {
    setCurrentPlanMode({
      isActive: false,
      currentPlan: null,
      history: [],
    });
    this.persist();
  }

  /**
   * Clear plan content only (Kimi Code-style /plan clear).
   * Keeps plan mode active, just empties the plan file/content.
   */
  clearPlanContent(): void {
    const plan = currentPlanMode.currentPlan;
    if (!plan) return;
    plan.content = '';
    plan.updatedAt = Date.now();
    setCurrentPlan(plan);
    this.persist();
  }

  /**
   * Toggle plan mode (Kimi Code-style /plan).
   */
  togglePlanMode(): boolean {
    if (currentPlanMode.isActive) {
      this.exitPlanMode();
      return false;
    } else {
      this.enterPlanMode();
      return true;
    }
  }

  // ── State Queries ──────────────────────────────────────────────────────

  /**
   * Check if plan mode is active.
   */
  isPlanModeActive(): boolean {
    return currentPlanMode.isActive;
  }

  /**
   * Get current plan.
   */
  getCurrentPlan(): PlanData | null {
    return currentPlanMode.currentPlan;
  }

  /**
   * Get plan mode state.
   */
  getState(): PlanModeState {
    return currentPlanMode;
  }

  // ── Plan File Operations ───────────────────────────────────────────────

  /**
   * Update plan content (called when LLM writes to plan file).
   */
  updatePlanContent(content: string, filePath?: string): void {
    const plan = currentPlanMode.currentPlan;
    if (!plan) return;

    plan.content = content;
    if (filePath) plan.path = filePath;
    plan.updatedAt = Date.now();
    setCurrentPlan(plan);
    this.persist();
  }

  /**
   * Get plan file path.
   */
  getPlanFilePath(): string {
    const plan = currentPlanMode.currentPlan;
    if (!plan) return '';
    return plan.path;
  }

  // ── Tool Restrictions ──────────────────────────────────────────────────

  /**
   * Check if a tool is allowed in plan mode (Kimi Code-style).
   * Returns true if tool should be blocked.
   */
  shouldBlockTool(toolName: string, filePath?: string): boolean {
    if (!currentPlanMode.isActive) return false;

    // Pi built-in tools: bash, edit, find, grep, ls, read, write
    // Read-only tools are always allowed (Pi built-in + our extensions)
    const readOnlyTools = ['read', 'grep', 'find', 'ls', 'get_goal'];
    if (readOnlyTools.includes(toolName)) return false;

    // Bash is allowed (for read-only commands)
    if (toolName === 'bash') return false;

    // Write/Edit to plan file is allowed
    if ((toolName === 'write' || toolName === 'edit') && filePath) {
      if (filePath.includes('/plans/') || filePath.endsWith('.plan.md')) {
        return false;
      }
    }

    // All other write/edit operations are blocked
    if (toolName === 'write' || toolName === 'edit') {
      return true;
    }

    return false;
  }

  // ── Context Injection ──────────────────────────────────────────────────

  /**
   * Build plan mode injection for system prompt (Kimi Code-style).
   */
  buildInjection(): string | undefined {
    if (!currentPlanMode.isActive) return undefined;

    const plan = currentPlanMode.currentPlan;
    if (!plan) return undefined;

    const parts = [
      `## Plan Mode Active`,
      ``,
      `You are in Plan Mode. Your task is to:`,
      `1. Explore the codebase using read-only tools (read, grep, find, ls)`,
      `2. Write a detailed implementation plan`,
      `3. Save the plan to a file`,
      ``,
      `Plan file path: ${plan.path || 'Not set yet'}`,
      ``,
      `**IMPORTANT**: You can ONLY use read-only tools and write/edit the plan file.`,
      `Do NOT modify any source code files until the plan is approved.`,
    ];

    if (plan.content) {
      parts.push(
        ``,
        `Current plan content:`,
        `---`,
        plan.content.slice(0, 500),
        `---`,
      );
    }

    return parts.join('\n');
  }

  /**
   * Inject plan into system prompt messages.
   */
  injectIntoMessages(messages: Array<{ role: string; content?: any }>): void {
    const injection = this.buildInjection();
    if (!injection) return;

    for (const msg of messages) {
      if (msg.role === 'system' || msg.role === 'developer') {
        if (Array.isArray(msg.content)) {
          msg.content.push({ type: 'text', text: `\n\n---\n${injection}` });
        } else if (typeof msg.content === 'string') {
          msg.content += `\n\n---\n${injection}`;
        }
        return;
      }
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────

  /**
   * Restore from persisted state.
   */
  restoreFromData(data: PlanModeState): void {
    setCurrentPlanMode(data);
  }

  // ── Format ─────────────────────────────────────────────────────────────

  /**
   * Format plan summary for display.
   */
  formatSummary(): string {
    if (!currentPlanMode.isActive) {
      return 'Plan mode is inactive.';
    }

    const plan = currentPlanMode.currentPlan;
    if (!plan) return 'Plan mode active, no plan.';

    const badge: Record<string, string> = {
      exploring: '🔍 Exploring',
      writing: '📝 Writing',
      reviewing: '👀 Reviewing',
      approved: '✅ Approved',
      rejected: '❌ Rejected',
    };

    const status = badge[plan.status] || plan.status;
    const content = plan.content ? ` (${plan.content.length} chars)` : '';

    return `${status}: ${plan.id}${content}`;
  }

  // ── Registration helpers ───────────────────────────────────────────────

  /** Register plan tools */
  registerTools(pi: any): void {
    registerPlanTools(pi, this);
  }

  /** Register plan commands */
  registerCommands(pi: any): void {
    registerPlanCommands(pi, this);
  }
}

export const planManager = new PlanManager();
