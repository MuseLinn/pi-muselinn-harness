// ============================================================
// Plan System — Kimi Code-style Plan Mode
// ============================================================

import type { PlanData, PlanStatus, PlanModeState } from "./types.ts";
import { planModeState, setCurrentPlanMode, setCurrentPlan, setPlanActive } from "./types.ts";
import { registerPlanTools } from "./tools.ts";
import { registerPlanCommands } from "./commands.ts";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Generate a unique plan ID.
 */
function generatePlanId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================
// Read-only Bash command whitelist (Plan Mode safety gate)
// ------------------------------------------------------------
// Plan Mode must allow exploration but must NOT allow writes,
// deletions, network mutations, or commits. This is a small,
// CONSERVATIVE regex whitelist of common read-only commands.
// Anything not matched here is denied (Plan Mode is restrictive
// by design). The list is intentionally easy to extend — add a
// new RegExp to READ_ONLY_BASH_PATTERNS to grow the allow-list.
// ============================================================

const READ_ONLY_BASH_PATTERNS: RegExp[] = [
  // ── Pure read-only coreutils ──
  /^\s*ls(\s|$)/,
  /^\s*dir(\s|$)/,  // Windows read-only directory listing
  /^\s*pwd(\s|$)/,
  /^\s*echo(\s|$)/,
  /^\s*cat(\s|$)/,
  /^\s*head(\s|$)/,
  /^\s*tail(\s|$)/,
  /^\s*less(\s|$)/,
  /^\s*more(\s|$)/,
  /^\s*wc(\s|$)/,
  /^\s*which(\s|$)/,
  /^\s*whereis(\s|$)/,
  /^\s*file(\s|$)/,
  /^\s*stat(\s|$)/,
  /^\s*du(\s|$)/,
  /^\s*df(\s|$)/,
  /^\s*env(\s|$)/,
  /^\s*printenv(\s|$)/,
  /^\s*whoami(\s|$)/,
  /^\s*hostname(\s|$)/,
  /^\s*uname(\s|$)/,
  /^\s*date(\s|$)/,
  /^\s*diff(\s|$)/,
  /^\s*cut(\s|$)/,
  /^\s*tr(\s|$)/,
  /^\s*uniq(\s|$)/,
  /^\s*sort(\s|$)/,
  // ── Search / inspect ──
  /^\s*grep(\s|$)/,
  /^\s*egrep(\s|$)/,
  /^\s*fgrep(\s|$)/,
  /^\s*rg(\s|$)/,
  /^\s*find(\s|$)/,
  // ── Git read-only ──
  /^\s*git\s+status(\s|$)/,
  /^\s*git\s+diff(\s|$)/,
  /^\s*git\s+log(\s|$)/,
  /^\s*git\s+show(\s|$)/,
  /^\s*git\s+blame(\s|$)/,
  /^\s*git\s+remote(\s|$)/,
  /^\s*git\s+branch(\s|$)/,  // bare `git branch` lists; write forms (-d/-m) blocked by deny-by-default of unknown flags? keep simple
  /^\s*git\s+ls-files(\s|$)/,
  /^\s*git\s+rev-parse(\s|$)/,
  // ── Node / package-manager dry, version, info only ──
  /^\s*node\s+--check(\s|$)/,
  /^\s*node\s+--version(\s|$)/,
  /^\s*node\s+-v(\s|$)/,
  /^\s*npm\s+(view|info|outdated|ls|list|--version|-v)(\s|$)/,
  /^\s*npm\s+test(\s+--dry-run)?(\s|$)/,
  /^\s*npm\s+run(\s|$)/,  // scripts may write; kept conservative but common. See note below.
  /^\s*npx\s+--version(\s|$)/,
  /^\s*tsc\s+--noEmit(\s|$)/,
  /^\s*pnpm\s+(list|ls|outdated|--version|-v)(\s|$)/,
];

/**
 * Global flags accepted after a leading `rtk` wrapper token. Keep small and
 * easy to extend — add new rtk global flags here as they appear.
 */
const RTK_GLOBAL_FLAGS = new Set(["-q", "--quiet", "--no-color"]);

/**
 * Normalize one command segment before whitelist matching.
 *
 * Third-party command wrappers (e.g. pi-rtk-optimizer, which loads before
 * this extension) mutate `event.input.command` in place, rewriting
 * `ls "D:/x"` → `rtk ls "D:/x"` (optionally with leading env assignments
 * like `RTK_FOO=1 rtk ls ...`). This gate vets the REWRITTEN string, so we
 * first peel off leading `KEY=VALUE` env assignments and a leading `rtk`
 * wrapper token (plus its global flags); the remaining segment is what gets
 * matched against READ_ONLY_BASH_PATTERNS. Anything we do not recognize is
 * left untouched and will be denied by the whitelist (deny-by-default).
 */
function normalizeBashSegment(seg: string): string {
  let s = seg;
  // Strip leading KEY=VALUE env assignments (quoted or bare values), repeatedly.
  const envAssign = /^\s*[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S*)\s+/;
  while (envAssign.test(s)) s = s.replace(envAssign, "");
  // Strip a leading `rtk` wrapper token plus its known global flags.
  if (/^\s*rtk(\s|$)/.test(s)) {
    s = s.replace(/^\s*rtk\s*/, "");
    let stripped = true;
    while (stripped) {
      stripped = false;
      const m = s.match(/^(\S+)(?:\s+|$)/);
      if (m && RTK_GLOBAL_FLAGS.has(m[1])) {
        s = s.slice(m[0].length);
        stripped = true;
      }
    }
  }
  return s;
}

/**
 * Determine whether a bash command string is read-only / safe in Plan Mode.
 *
 * Strategy:
 * 1. Reject if the command contains shell injection / write primitives we
 *    cannot statically vet: command substitution (`backticks` / `$(...)`),
 *    output redirection (`>` / `>>` / `2>`), or the `find ... -exec` /
 *    `-delete` side-effecting forms.
 * 2. Split the remaining command on pipe / sequence separators (`|`, `||`,
 *    `&&`, `;`), normalize each segment (strip env assignments and a leading
 *    `rtk` wrapper — see normalizeBashSegment), and require EVERY segment to
 *    match the read-only whitelist.
 * 3. Any segment that does not match a whitelist entry → deny.
 *
 * Deny-by-default: an unmatched command is blocked, not silently allowed.
 * To allow more commands, extend READ_ONLY_BASH_PATTERNS above.
 */
function isReadOnlyBashCommand(cmd: string): boolean {
  if (!cmd) return false;
  const trimmed = cmd.trim();
  if (!trimmed) return false;

  // Block command substitution and output redirection outright.
  if (/`/.test(trimmed)) return false;
  if (/\$\(/.test(trimmed)) return false;
  if (/>>?/.test(trimmed)) return false;       // `>` or `>>`
  if (/\b2>>?\b/.test(trimmed)) return false;  // stderr redirect
  if (/<</.test(trimmed)) return false;        // heredoc (write-ish / injection)
  // Block find side-effecting forms.
  if (/\bfind\b.*\s-exec\b/.test(trimmed)) return false;
  if (/\bfind\b.*\s-delete\b/.test(trimmed)) return false;
  // Block common mutating git sub-commands even if pattern above matched a
  // benign-looking prefix (defence in depth).
  if (/\bgit\s+(push|commit|reset|merge|rebase|checkout|switch|pull|fetch|clone|stash\s+(drop|pop)|cherry-pick|tag\s+-d)\b/.test(trimmed)) {
    return false;
  }
  // Block package install / publish that mutate node_modules or registries.
  if (/\b(npm|pnpm|yarn)\s+(install|i|add|remove|uninstall|publish|ci|run\s+build)\b/.test(trimmed)) {
    return false;
  }

  // Split on sequence / pipe operators and vet each segment.
  const segments = trimmed.split(/\s*(?:\|\||&&|;|\|)\s*/);
  for (const seg of segments) {
    if (!seg) continue;
    const normalized = normalizeBashSegment(seg);
    if (!normalized) return false;
    const matched = READ_ONLY_BASH_PATTERNS.some((re) => re.test(normalized));
    if (!matched) return false;
  }
  return true;
}

// ============================================================
// PlanManager — lifecycle + persistence + injection
// ============================================================

export class PlanManager {
  private persistFn: ((data: PlanModeState) => void) | null = null;
  private sessionDir: string = '';
  /** Serialized state of the last appended entry — dedup baseline. */
  private lastPersistedJson: string | null = null;

  /** Bind a persistence callback */
  setPersistence(fn: (data: PlanModeState) => void): void {
    this.persistFn = fn;
  }

  /** Set session directory for plan file storage */
  setSessionDir(dir: string): void {
    this.sessionDir = dir;
  }

  private static safeStringify(value: unknown): string | null {
    try { return JSON.stringify(value); } catch { return null; }
  }

  /**
   * Persist current state.
   * Dedup: skip the append when the serialized state is identical to the
   * last persisted one. Restore validation and repeat lifecycle calls
   * (e.g. exitPlanMode on an already-exited plan) retrigger persist without
   * changing state, which previously appended duplicate muselinn_plan entries.
   */
  private persist(): void {
    if (!this.persistFn) return;
    const json = PlanManager.safeStringify(planModeState);
    if (json !== null && json === this.lastPersistedJson) return;
    if (json !== null) this.lastPersistedJson = json;
    this.persistFn(planModeState);
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

  /** Ensure plan directory exists (Kimi Code-style) */
  private ensurePlanDirectory(planPath: string): void {
    try {
      const dir = path.dirname(planPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch { /* not critical */ }
  }

  /**
   * Enter Plan Mode (Kimi Code-style).
   * Called by EnterPlanMode tool or /plan command.
   * Creates the plan directory immediately (Kimi Code-style: ensurePlanDirectory).
   */
  enterPlanMode(reason?: string): PlanData {
    const heroSlug = this.generateHeroSlug();
    const planPath = this.sessionDir
      ? path.join(this.sessionDir, "plans", heroSlug) + ".md"
      : path.join("plans", heroSlug) + ".md";
    const plan: PlanData = {
      id: generatePlanId(),
      content: '',
      path: planPath,
      status: 'exploring',
      createdAt: Date.now(),
    };

    this.ensurePlanDirectory(planPath);

    // Write an initial placeholder plan file if none exists yet, so the
    // review panel never hits "plan file not found" for a plan created in
    // this session. Best-effort: a read-only FS must not break plan mode.
    try {
      if (!fs.existsSync(planPath)) {
        fs.writeFileSync(planPath, "# Plan\n\n(Write your plan here.)\n", "utf-8");
      }
    } catch { /* not critical */ }

    setCurrentPlanMode({
      isActive: true,
      currentPlan: plan,
      history: [...planModeState.history, plan],
    });
    this.persist();

    return plan;
  }

  /**
   * Exit Plan Mode (Kimi Code-style).
   * Called by ExitPlanMode tool.
   */
  exitPlanMode(): PlanData | null {
    const plan = planModeState.currentPlan;
    if (!plan) return null;

    // Sync in-memory content from the on-disk plan file (when present and
    // readable) so the review panel and any in-memory consumer see the real
    // plan, not a stale/empty snapshot.
    if (plan.path) {
      try {
        if (fs.existsSync(plan.path)) {
          plan.content = fs.readFileSync(plan.path, "utf-8");
        }
      } catch { /* keep in-memory content on read failure */ }
    }

    plan.status = 'reviewing';
    setCurrentPlan(plan);
    setPlanActive(false);
    this.persist();

    return plan;
  }

  /**
   * Re-enter plan mode to revise the CURRENT plan (Revise path).
   *
   * Unlike enterPlanMode(), this keeps the SAME plan object — same id, same
   * file path, same content — so the user's review context and everything
   * already written survive the round-trip. Falls back to enterPlanMode()
   * only when there is no current plan to revise.
   *
   * @param feedback Optional user feedback from the Revise dialog.
   */
  reenterForRevision(feedback?: string): PlanData {
    const plan = planModeState.currentPlan;
    if (!plan) {
      return this.enterPlanMode("Plan revision requested");
    }

    plan.status = 'writing';
    plan.updatedAt = Date.now();
    if (feedback) {
      plan.revisionFeedback = feedback;
    }
    setCurrentPlan(plan);
    setPlanActive(true);
    this.persist();

    return plan;
  }

  /**
   * Approve the current plan.
   */
  approvePlan(): PlanData | null {
    const plan = planModeState.currentPlan;
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
    const plan = planModeState.currentPlan;
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
    const plan = planModeState.currentPlan;
    if (!plan) return;
    plan.content = '';
    plan.updatedAt = Date.now();
    setCurrentPlan(plan);
    this.persist();
  }

  /**
   * Set user revision feedback on the current plan.
   * This is used when the user selects Revise and provides
   * textual feedback on what needs to change.
   */
  setRevisionFeedback(feedback: string): void {
    const plan = planModeState.currentPlan;
    if (!plan) return;
    plan.revisionFeedback = feedback;
    plan.updatedAt = Date.now();
    setCurrentPlan(plan);
    this.persist();
  }

  /**
   * Toggle plan mode (Kimi Code-style /plan).
   */
  togglePlanMode(): boolean {
    if (planModeState.isActive) {
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
    return planModeState.isActive;
  }

  /**
   * Get current plan.
   */
  getCurrentPlan(): PlanData | null {
    return planModeState.currentPlan;
  }

  /**
   * Get plan mode state.
   */
  getState(): PlanModeState {
    return planModeState;
  }

  // ── Plan File Operations ───────────────────────────────────────────────

  /**
   * Update plan content (called when LLM writes to plan file).
   */
  updatePlanContent(content: string, filePath?: string): void {
    const plan = planModeState.currentPlan;
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
    const plan = planModeState.currentPlan;
    if (!plan) return '';
    return plan.path;
  }

  // ── Tool Restrictions ──────────────────────────────────────────────────

  /**
   * Check if a tool is allowed in plan mode (Kimi Code-style).
   * Returns true if tool should be blocked.
   *
   * Optional `command` is the bash command string (only relevant when
   * toolName === 'bash'); it is vetted by the read-only whitelist
   * (isReadOnlyBashCommand). When omitted, bash is denied (deny-by-default).
   */
  shouldBlockTool(toolName: string, filePath?: string, command?: string): boolean {
    if (!planModeState.isActive) return false;

    // Pi built-in tools: bash, edit, find, grep, ls, read, write
    // Read-only tools are always allowed (Pi built-in + our extensions)
    const readOnlyTools = ['read', 'grep', 'find', 'ls', 'get_goal'];
    if (readOnlyTools.includes(toolName)) return false;

    // Bash: apply a conservative read-only whitelist. Commands that do not
    // match are blocked — Plan Mode is restrictive by design. Extend
    // READ_ONLY_BASH_PATTERNS above to allow more read-only commands.
    if (toolName === 'bash') {
      if (typeof command !== "string" || !isReadOnlyBashCommand(command)) {
        return true; // deny
      }
      return false;
    }

    // Write/Edit to plan file is allowed — but only when the resolved path
    // is inside the resolved plan directory. The previous check used loose
    // substring heuristics (`includes('/plans/')` / `endsWith('.plan.md')`)
    // which could be bypassed via crafted paths (e.g. `../plans/evil.md`
    // outside the session, or any `*.plan.md` anywhere).
    if ((toolName === 'write' || toolName === 'edit') && filePath) {
      const resolvedFile = path.resolve(filePath);
      const planDir = path.resolve(
        this.sessionDir ? path.join(this.sessionDir, "plans") : path.join("plans")
      );
      // Must be strictly *inside* planDir (planDir + path.sep prefix).
      // Matches the file itself if it lives directly under planDir.
      if (resolvedFile === planDir || resolvedFile.startsWith(planDir + path.sep)) {
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
    if (!planModeState.isActive) return undefined;

    const plan = planModeState.currentPlan;
    // Use plan path or default to sessionDir-based path
    const planPath = plan?.path || (this.sessionDir ? `${this.sessionDir}/plans/` : "plans/");

    const parts = [
      `## Plan Mode Active`,
      ``,
      `You are in Plan Mode. Your task is to:`,
      `1. Explore the codebase using read-only tools (read, grep, find, ls)`,
      `2. Write a detailed implementation plan`,
      `3. Save the plan to a file (use path: \`${planPath}\`)`,
      ``,
      `Plan file path: ${planPath}`,
      ``,
      `**IMPORTANT**: You can ONLY use read-only tools and write/edit the plan file.`,
      `Do NOT modify any source code files until the plan is approved.`,
    ];

    if (plan && plan.content) {
      parts.push(
        ``,
        `Current plan content:`,
        `---`,
        plan.content.slice(0, 500),
        `---`,
      );
    }

    // Inject user's revision feedback when in revision mode
    if (plan && plan.revisionFeedback) {
      parts.push(
        ``,
        `## User Revision Feedback`,
        ``,
        `The user requested the following changes to the plan:`,
        `> ${plan.revisionFeedback}`,
        ``,
        `Please update the plan accordingly.`,
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
    // The restored state is already persisted — seed the dedup baseline so a
    // subsequent no-change persist doesn't append a duplicate entry.
    this.lastPersistedJson = PlanManager.safeStringify(planModeState);
  }

  /**
   * Validate restored plan state (call right after restoreFromData).
   *
   * A stale persisted entry can claim plan mode is active while holding an
   * empty plan whose file no longer exists on disk — that would silently
   * trap the session in plan mode with nothing to review. In that case we
   * deactivate plan mode (and drop the dead plan) instead.
   *
   * Invalid when: isActive is true but there is no currentPlan, OR the
   * current plan has empty content AND its file does not exist on disk.
   *
   * Returns true when plan mode remains active after validation.
   */
  validateRestoredState(): boolean {
    if (!planModeState.isActive) return false;

    const plan = planModeState.currentPlan;
    let stale = false;
    if (!plan) {
      stale = true;
    } else if (!plan.content) {
      let fileExists = false;
      try {
        fileExists = !!plan.path && fs.existsSync(plan.path);
      } catch { /* treat stat failure as missing */ }
      stale = !fileExists;
    }

    if (stale) {
      setCurrentPlan(null);
      setPlanActive(false);
      this.persist();
      return false;
    }
    return true;
  }

  // ── Format ─────────────────────────────────────────────────────────────

  /**
   * Format plan summary for display.
   */
  formatSummary(): string {
    if (!planModeState.isActive) {
      return 'Plan mode is inactive.';
    }

    const plan = planModeState.currentPlan;
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
