// ============================================================
// TasksBrowserComponent — Kimi Code-style full Task Browser
// Architecture: Component class with setProps(), handleInput(), render()
// ============================================================

import { Container, Text, truncateToWidth, visibleWidth, matchesKey } from "@earendil-works/pi-tui";
import type { KeybindingsManager } from "@earendil-works/pi-tui";
import type { SubAgentTask } from "./types";
import {
  statusGlyph,
  statusColorName,
  statusLabel,
  isTerminalStatus,
  compareTasks,
  collapseTaskList,
  formatCollapseSummary,
  routeBrowserKey,
  routeViewerKey,
  type KeyMatchFn,
} from "./task-list-utils";

const ELLIPSIS = "…";
const MIN_WIDTH = 48;
const MIN_HEIGHT = 10;
const LIST_COL_MIN = 28;
const LIST_COL_MAX = 44;
const LIST_COL_RATIO = 0.32;
// P0 fix: bound the viewer's local copy of output lines to prevent unbounded accumulation
// when a task runs for a long time. Only affects the viewer snapshot; the underlying
// task.outputLines storage is not mutated.
const MAX_VIEWER_LINES = 2000;

// Legacy keyId fallbacks for the named pi-tui keybindings, used when the
// KeybindingsManager is unavailable (older pi, non-interactive smoke runs).
const NAMED_KEY_FALLBACK: Record<string, string> = {
  "tui.select.up": "up",
  "tui.select.down": "down",
  "tui.select.confirm": "enter",
  "tui.select.cancel": "escape",
  "tui.select.pageUp": "pageUp",
  "tui.select.pageDown": "pageDown",
};

// ============================================================
// Helper functions
// ============================================================

function isTerminal(status: string): boolean {
  return isTerminalStatus(status);
}

function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function padToWidth(line: string, width: number): string {
  const w = visibleWidth(line);
  if (w === width) return line;
  if (w > width) return truncateToWidth(line, width, ELLIPSIS);
  return line + " ".repeat(width - w);
}

function fitExactly(line: string, width: number): string {
  let s = line;
  if (visibleWidth(s) > width) s = truncateToWidth(s, width, ELLIPSIS);
  return padToWidth(s, width);
}

// ============================================================
// Props interface
// ============================================================

export interface TasksBrowserProps {
  tasks: readonly SubAgentTask[];
  filter: "all" | "active";
  selectedTaskId: string | undefined;
  outputPreview: string | undefined;
  flashMessage: string | undefined;
  onSelect: (taskId: string) => void;
  onToggleFilter: () => void;
  onRefresh: () => void;
  onCancel: () => void;
  onStopConfirmed: (taskId: string) => void;
  onOpenOutput: (taskId: string) => void;
}

// ============================================================
// Theme helper (wraps theme object)
// ============================================================

function styledFg(theme: any, color: string, text: string): string {
  return theme.fg(color, text);
}

function styledBoldFg(theme: any, color: string, text: string): string {
  return theme.bold(theme.fg(color, text));
}

// ============================================================
// TasksBrowserComponent class
// ============================================================

export class TasksBrowserComponent extends Container {
  focused = false;

  private props: TasksBrowserProps;
  private theme: any;
  private sortedVisible: SubAgentTask[];
  private selectedIndex = 0;
  private pendingStopTaskId: string | undefined = undefined;
  private pendingStopTimer: NodeJS.Timeout | undefined = undefined;
  private keybindings: KeybindingsManager | undefined = undefined;

  // ── Output Viewer state ──
  private viewerOpen = false;
  private viewerScrollTop = 0;
  private viewerFollowTail = true;
  private viewerOutputLines: string[] = [];
  private viewerTaskId = "";

  constructor(props: TasksBrowserProps, theme: any) {
    super();
    this.props = props;
    this.theme = theme;
    this.sortedVisible = [...props.tasks].filter(
      (t) => props.filter === "all" || !isTerminal(t.status),
    ).sort(compareTasks);
    this.syncSelectionFromProps();
  }

  setProps(next: TasksBrowserProps): void {
    this.props = next;
    this.sortedVisible = [...next.tasks].filter(
      (t) => next.filter === "all" || !isTerminal(t.status),
    ).sort(compareTasks);
    this.syncSelectionFromProps();
    if (this.pendingStopTaskId !== undefined) {
      const task = next.tasks.find((t) => t.id === this.pendingStopTaskId);
      if (task === undefined || isTerminal(task.status)) this.clearPendingStop();
    }
    this.invalidate();
  }

  setTheme(theme: any): void {
    this.theme = theme;
  }

  /**
   * Receive pi's KeybindingsManager (the third argument of the
   * ctx.ui.custom factory). Named keybindings (tui.select.*) then honor
   * user keybinding overrides; without it we fall back to pi-tui
   * default key sequences via matchesKey.
   */
  setKeybindings(kb: KeybindingsManager | undefined): void {
    this.keybindings = kb;
  }

  /**
   * Key matcher injected into the pure routers in task-list-utils.ts.
   * Named keybindings (tui.select.*) go through the KeybindingsManager
   * first, falling back to the pi-tui default sequence; everything else
   * (letters, tab, home/end) goes through matchesKey directly.
   */
  private matchKey: KeyMatchFn = (data, keyId) => {
    if (keyId.startsWith("tui.")) {
      try {
        if (this.keybindings && this.keybindings.matches(data, keyId as any)) return true;
      } catch { /* fall through to legacy default */ }
      const legacy = NAMED_KEY_FALLBACK[keyId];
      if (!legacy) return false;
      try { return matchesKey(data, legacy as any); } catch { return false; }
    }
    try { return matchesKey(data, keyId as any); } catch { return false; }
  };

  /**
   * True when the component wants to consume this input itself (output
   * viewer is open, or a stop confirmation is pending) instead of letting
   * the host treat ESC/q as "close overlay".
   */
  wantsInput(): boolean {
    return this.viewerOpen || this.pendingStopTaskId !== undefined;
  }

  /**
   * Release all pending timers. Called by pi's close() path
   * (ctx.ui.custom disposes the component wrapper) and by the /tasks
   * command's own cleanup, so the 5s stop-confirmation timer can never
   * fire into a destroyed overlay.
   */
  dispose(): void {
    this.clearPendingStop();
  }

  private syncSelectionFromProps(): void {
    if (this.sortedVisible.length === 0) {
      this.selectedIndex = 0;
      return;
    }
    if (this.props.selectedTaskId !== undefined) {
      const idx = this.sortedVisible.findIndex((t) => t.id === this.props.selectedTaskId);
      if (idx !== -1) {
        this.selectedIndex = idx;
        return;
      }
    }
    if (this.selectedIndex >= this.sortedVisible.length) {
      this.selectedIndex = this.sortedVisible.length - 1;
    }
  }

  private clearPendingStop(): void {
    this.pendingStopTaskId = undefined;
    if (this.pendingStopTimer !== undefined) {
      clearTimeout(this.pendingStopTimer);
      this.pendingStopTimer = undefined;
    }
  }

  private emitSelect(): void {
    const task = this.sortedVisible[this.selectedIndex];
    if (task) this.props.onSelect(task.id);
  }

  // ── Keyboard handling ──────────────────────────────────────────

  handleInput(data: string): void {
    // Viewer mode — separate keyboard handling
    if (this.viewerOpen) {
      this.handleViewerInput(data);
      return;
    }

    const action = routeBrowserKey(data, this.pendingStopTaskId !== undefined, this.matchKey);

    switch (action) {
      case "confirmStop": {
        const taskId = this.pendingStopTaskId!;
        this.clearPendingStop();
        // P0 fix: surface abort failures instead of silently swallowing. The underlying
        // abort().catch(()=>{}) in commands.ts swallows errors, so best-effort report
        // via console.error here.
        try {
          this.props.onStopConfirmed(taskId);
        } catch (e) {
          console.error(`[swarm] onStopConfirmed failed for ${taskId}:`, e);
        }
        this.invalidate();
        return;
      }
      case "dismissStop": {
        this.clearPendingStop();
        this.invalidate();
        return;
      }
      case "cancel": {
        this.props.onCancel();
        return;
      }
      case "moveUp": {
        if (this.sortedVisible.length === 0) return;
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        this.emitSelect();
        this.invalidate();
        return;
      }
      case "moveDown": {
        if (this.sortedVisible.length === 0) return;
        this.selectedIndex = Math.min(this.sortedVisible.length - 1, this.selectedIndex + 1);
        this.emitSelect();
        this.invalidate();
        return;
      }
      case "toggleFilter": {
        this.props.onToggleFilter();
        return;
      }
      case "refresh": {
        this.props.onRefresh();
        return;
      }
      case "requestStop": {
        const task = this.sortedVisible[this.selectedIndex];
        if (task === undefined) return;
        if (isTerminal(task.status)) return;
        this.pendingStopTaskId = task.id;
        this.pendingStopTimer = setTimeout(() => {
          this.clearPendingStop();
          this.invalidate();
        }, 5000);
        this.invalidate();
        return;
      }
      case "openOutput": {
        const task = this.sortedVisible[this.selectedIndex];
        if (task) {
          // Open full-screen output viewer with real output
          this.viewerOpen = true;
          this.viewerScrollTop = 0;
          this.viewerFollowTail = true;
          this.viewerTaskId = task.id;
          // P0 fix: keep only the most recent MAX_VIEWER_LINES lines for the viewer to bound memory.
          this.viewerOutputLines = (task.outputLines || []).slice(-MAX_VIEWER_LINES);
          this.invalidate();
        }
        return;
      }
      case "ignore":
        return;
    }
  }

  // ── Main render ────────────────────────────────────────────────

  override render(width: number): string[] {
    // Viewer mode — full-screen output
    if (this.viewerOpen) return this.renderViewer(width);

    if (width < MIN_WIDTH) {
      return this.renderTooSmall(width, 24);
    }

    const t = this.theme;
    const rows = 24; // Pi overlay height estimate
    const header = this.renderHeader(width);
    const footer = this.renderFooter(width);
    const bodyHeight = Math.max(4, rows - 2);

    const listWidth = Math.max(
      LIST_COL_MIN,
      Math.min(LIST_COL_MAX, Math.floor(width * LIST_COL_RATIO)),
    );
    const rightWidth = width - listWidth;

    const listFrame = this.renderListFrame(listWidth, bodyHeight);
    const rightFrames = this.renderRightStack(rightWidth, bodyHeight);

    // Inner content (without border)
    const inner: string[] = [header];
    for (let i = 0; i < bodyHeight; i++) {
      inner.push(
        (listFrame[i] ?? " ".repeat(listWidth)) +
        (rightFrames[i] ?? " ".repeat(rightWidth)),
      );
    }
    inner.push(footer);

    // Wrap in an outer frame border for visual separation
    const innerW = width - 2;
    const borderTop = t.fg("muted", "┌") + t.fg("muted", "─".repeat(innerW)) + t.fg("muted", "┐");
    const borderBot = t.fg("muted", "└") + t.fg("muted", "─".repeat(innerW)) + t.fg("muted", "┘");
    const bordered: string[] = [borderTop];
    for (const line of inner) {
      bordered.push(t.fg("muted", "│") + fitExactly(line, innerW) + t.fg("muted", "│"));
    }
    bordered.push(borderBot);
    return bordered;
  }

  // ── Header / Footer ───────────────────────────────────────────

  private renderHeader(width: number): string {
    const title = styledBoldFg(this.theme, "accent", " TASK BROWSER ");
    const filterText = styledFg(this.theme, "muted", ` filter=${this.props.filter === "all" ? "ALL" : "ACTIVE"} `);

    const visible = this.props.filter === "active"
      ? this.props.tasks.filter((t) => t.status === "running" || t.status === "pending")
      : this.props.tasks;

    const running = visible.filter((t) => t.status === "running").length;
    const completed = visible.filter((t) => t.status === "done").length;
    const failed = visible.filter((t) => t.status === "failed" || t.status === "aborted").length;

    const countSegments: string[] = [];
    if (running > 0) countSegments.push(styledFg(this.theme, "success", ` ${running} running `));
    if (completed > 0) countSegments.push(styledFg(this.theme, "muted", ` ${completed} completed `));
    if (failed > 0) countSegments.push(styledFg(this.theme, "error", ` ${failed} interrupted `));
    const totals = styledFg(this.theme, "muted", ` ${visible.length} total `);

    return fitExactly(title + filterText + countSegments.join("") + totals, width);
  }

  private renderFooter(width: number): string {
    if (this.pendingStopTaskId !== undefined) {
      const warn = styledBoldFg(this.theme, "warning", "Stop");
      const id = styledFg(this.theme, "text", this.pendingStopTaskId);
      const key = (t: string) => styledBoldFg(this.theme, "accent", t);
      const dim = (t: string) => styledFg(this.theme, "muted", t);
      return fitExactly(
        ` ${warn} ${id}? ${key("Y")} ${dim("confirm")}  ${key("N")}${dim("/")}${key("esc")} ${dim("cancel")} `,
        width,
      );
    }

    const key = (t: string) => styledBoldFg(this.theme, "accent", t);
    const dim = (t: string) => styledFg(this.theme, "muted", t);
    const parts = [
      ` ${key("↑↓")} ${dim("select")}`,
      `${key("Enter/O")} ${dim("output")}`,
      `${key("S")} ${dim("stop")}`,
      `${key("R")} ${dim("refresh")}`,
      `${key("Tab")} ${dim("filter")}`,
      `${key("Q/Esc")} ${dim("close")} `,
    ];
    const left = parts.join("  ");
    const flash = this.props.flashMessage;
    if (flash !== undefined && flash.length > 0) {
      const flashStyled = styledFg(this.theme, "warning", ` ${flash} `);
      const total = visibleWidth(left) + visibleWidth(flashStyled);
      if (total <= width) {
        return left + " ".repeat(width - total) + flashStyled;
      }
    }
    return fitExactly(left, width);
  }

  // ── Frame primitive ────────────────────────────────────────────

  private renderFrame(
    title: string,
    content: readonly string[],
    width: number,
    height: number,
  ): string[] {
    if (height < 2 || width < 4) {
      const out: string[] = [];
      for (let i = 0; i < height; i++) out.push(" ".repeat(width));
      return out;
    }
    const innerWidth = width - 2;
    const innerHeight = height - 2;

    const titleStyled = styledBoldFg(this.theme, "accent", title);
    const titleSegment = `─ ${titleStyled} `;
    const titleSegmentWidth = visibleWidth(titleSegment);
    const remainingDashes = Math.max(0, innerWidth - titleSegmentWidth);
    const topMid =
      titleSegmentWidth <= innerWidth
        ? styledFg(this.theme, "accent", "─ ") +
          titleStyled +
          " " +
          styledFg(this.theme, "accent", "─".repeat(remainingDashes))
        : styledFg(this.theme, "accent", "─".repeat(innerWidth));
    const top =
      styledFg(this.theme, "accent", "┌") +
      topMid +
      styledFg(this.theme, "accent", "┐");
    const bottom = styledFg(
      this.theme,
      "accent",
      "└" + "─".repeat(innerWidth) + "┘",
    );

    const lines: string[] = [top];
    for (let i = 0; i < innerHeight; i++) {
      const inner = content[i] ?? "";
      lines.push(
        styledFg(this.theme, "accent", "│") +
          fitExactly(inner, innerWidth) +
          styledFg(this.theme, "accent", "│"),
      );
    }
    lines.push(bottom);
    return lines;
  }

  // ── Left: task list frame ──────────────────────────────────────

  private renderListFrame(width: number, height: number): string[] {
    const title = `Tasks [${this.props.filter}]`;
    const innerHeight = Math.max(0, height - 2);

    if (this.sortedVisible.length === 0) {
      const empty =
        this.props.filter === "active"
          ? "No active tasks. Tab = show all."
          : "No tasks in this swarm.";
      const lines: string[] = [styledFg(this.theme, "muted", empty)];
      while (lines.length < innerHeight) lines.push("");
      return this.renderFrame(title, lines, width, height);
    }

    // Overflow collapse (rpiv-todo semantics): when the list does not fit
    // the window, reserve the last row for a "+N more (x done, y running)"
    // summary and keep tasks by priority — running first, done dropped
    // first. The selected task is always kept visible.
    const collapsed = collapseTaskList(this.sortedVisible, innerHeight, this.selectedIndex);
    const summaryText = formatCollapseSummary(collapsed.hidden);

    const innerWidth = width - 2;
    const lines: string[] = [];
    for (const task of collapsed.visible) {
      const index = this.sortedVisible.indexOf(task);
      lines.push(this.renderListRow(task, index === this.selectedIndex, innerWidth));
    }
    if (summaryText !== null && lines.length < innerHeight) {
      lines.push(styledFg(this.theme, "dim", ` ${summaryText}`));
    }
    while (lines.length < innerHeight) lines.push("");

    return this.renderFrame(title, lines, width, height);
  }

  private renderListRow(task: SubAgentTask, selected: boolean, innerWidth: number): string {
    const pointer = selected ? "▸ " : "  ";
    const pointerStyled = styledFg(this.theme, selected ? "accent" : "dim", pointer);

    const idColor = selected ? "accent" : "accent";
    const idText = selected
      ? styledBoldFg(this.theme, idColor, task.id)
      : styledFg(this.theme, idColor, task.id);
    const idPad = " ".repeat(Math.max(0, 6 - task.id.length));

    const icon = statusGlyph(task.status);
    const statusBadge = styledFg(this.theme, statusColorName(task.status), icon);

    const prefix = `${pointerStyled}${idText}${idPad} ${statusBadge}`;
    const prefixWidth = visibleWidth(prefix);
    const descBudget = Math.max(0, innerWidth - prefixWidth - 1);
    if (descBudget < 4) return fitExactly(prefix, innerWidth);

    const description =
      singleLine((task.item || task.task || "").slice(0, 30)) ||
      "(no description)";
    let desc = truncateToWidth(description, descBudget, ELLIPSIS);
    // rpiv-todo semantics: completed tasks render dim + strikethrough.
    if (task.status === "done") {
      desc = typeof this.theme?.strikethrough === "function"
        ? this.theme.strikethrough(this.theme.fg("dim", desc))
        : this.theme.fg("dim", desc);
      return fitExactly(`${prefix} ${desc}`, innerWidth);
    }
    return fitExactly(`${prefix} ${styledFg(this.theme, "text", desc)}`, innerWidth);
  }

  // ── Right: detail + preview stack ──────────────────────────────

  private renderRightStack(width: number, height: number): string[] {
    const detailHeight = Math.max(8, Math.min(Math.floor(height * 0.4), height - 5));
    const previewHeight = height - detailHeight;
    return [
      ...this.renderDetailFrame(width, detailHeight),
      ...this.renderPreviewFrame(width, previewHeight),
    ];
  }

  private renderDetailFrame(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const task = this.sortedVisible[this.selectedIndex];
    if (task === undefined) {
      const empty = styledFg(this.theme, "muted", "Select a task from the list.");
      const lines: string[] = [empty];
      while (lines.length < innerHeight) lines.push("");
      return this.renderFrame("Detail", lines, width, height);
    }

    const label = (text: string): string => styledFg(this.theme, "muted", text.padEnd(14));
    const value = (text: string): string => styledFg(this.theme, "text", text);

    const lines: string[] = [
      `${label("Task ID:")}${value(task.id)}`,
      `${label("Status:")}${styledFg(this.theme, statusColorName(task.status), statusLabel(task.status))}`,
      `${label("Description:")}${value(singleLine((task.item || task.task || "").slice(0, 50)) || "—")}`,
      `${label("Agent type:")}${value(task.type)}`,
      `${label("Model:")}${value(task.model)}`,
      `${label("Turns:")}${value(String(task.turns))}`,
      `${label("Tokens:")}${value(`↑${task.usage.input} ↓${task.usage.output}`)}`,
      `${label("Cost:")}${value(task.usage.cost === 0 ? "$0" : `$${task.usage.cost.toFixed(4)}`)}`,
    ];

    const dur = task.startTime
      ? task.endTime
        ? formatTime(task.endTime - task.startTime)
        : formatTime(Date.now() - task.startTime) + " (running)"
      : "—";
    lines.push(`${label("Duration:")}${value(dur)}`);

    if (task.currentAction) {
      lines.push(`${label("Action:")}${styledFg(this.theme, "dim", singleLine(task.currentAction).slice(0, 50))}`);
    }
    if (task.error) {
      lines.push(`${label("Error:")}${styledFg(this.theme, "error", singleLine(task.error).slice(0, 50))}`);
    }

    while (lines.length < innerHeight) lines.push("");
    return this.renderFrame("Detail", lines, width, height);
  }

  private renderPreviewFrame(width: number, height: number): string[] {
    const innerHeight = Math.max(0, height - 2);
    const task = this.sortedVisible[this.selectedIndex];
    if (task === undefined) {
      const lines: string[] = [styledFg(this.theme, "muted", "No task selected.")];
      while (lines.length < innerHeight) lines.push("");
      return this.renderFrame("Preview Output", lines, width, height);
    }

    // Use real output from task.outputLines, fallback to outputPreview
    let body: string;
    const outputLines = task.outputLines;
    if (outputLines && outputLines.length > 0) {
      body = outputLines.join("\n");
    } else if (this.props.outputPreview && this.props.outputPreview.length > 0) {
      body = this.props.outputPreview;
    } else {
      body = "[no output captured]";
    }

    const rawLines = body.split("\n");
    const tailLines = rawLines.slice(-innerHeight);
    const styled = tailLines.map((line) => styledFg(this.theme, "dim", line));
    while (styled.length < innerHeight) styled.push("");
    return this.renderFrame("Preview Output", styled, width, height);
  }

  // ── Too small fallback ─────────────────────────────────────────

  private renderTooSmall(width: number, rows: number): string[] {
    const lines: string[] = [];
    const msg = styledFg(
      this.theme,
      "error",
      `Terminal too small (need ≥ ${MIN_WIDTH} × ${MIN_HEIGHT})`,
    );
    lines.push(fitExactly(msg, width));
    for (let i = 1; i < rows; i++) lines.push(" ".repeat(width));
    return lines;
  }

  // ── Output Viewer ──────────────────────────────────────────────

  private handleViewerInput(data: string): void {
    const totalLines = this.viewerOutputLines.length;
    const action = routeViewerKey(data, this.matchKey);

    switch (action) {
      case "close": {
        this.viewerOpen = false;
        this.invalidate();
        return;
      }
      case "scrollUp": {
        this.viewerScrollTop = Math.max(0, this.viewerScrollTop - 1);
        this.viewerFollowTail = false;
        this.invalidate();
        return;
      }
      case "scrollDown": {
        this.viewerScrollTop = Math.min(Math.max(0, totalLines - 1), this.viewerScrollTop + 1);
        this.viewerFollowTail = false;
        this.invalidate();
        return;
      }
      case "pageUp": {
        this.viewerScrollTop = Math.max(0, this.viewerScrollTop - 20);
        this.viewerFollowTail = false;
        this.invalidate();
        return;
      }
      case "pageDown": {
        this.viewerScrollTop = Math.min(Math.max(0, totalLines - 1), this.viewerScrollTop + 20);
        this.viewerFollowTail = false;
        this.invalidate();
        return;
      }
      case "top": {
        this.viewerScrollTop = 0;
        this.viewerFollowTail = false;
        this.invalidate();
        return;
      }
      case "bottom": {
        this.viewerScrollTop = Math.max(0, totalLines - 1);
        this.viewerFollowTail = true;
        this.invalidate();
        return;
      }
      case "ignore":
        return;
    }
  }

  private renderViewer(width: number): string[] {
    const t = this.theme;
    const rows = 24;
    const innerW = width - 2;

    // Header
    const task = this.sortedVisible.find((t) => t.id === this.viewerTaskId);
    const titleText = styledBoldFg(t, "accent", ` OUTPUT: ${this.viewerTaskId} `);
    const statusText = task ? styledFg(t, statusColorName(task.status), ` ${statusLabel(task.status)} `) : "";
    const header = fitExactly(titleText + statusText, width);

    // Footer
    const totalLines = this.viewerOutputLines.length;
    const key = (s: string) => styledBoldFg(t, "accent", s);
    const dim = (s: string) => styledFg(t, "muted", s);
    const position = `${this.viewerScrollTop + 1}-${Math.min(this.viewerScrollTop + rows - 4, totalLines)} / ${totalLines}`;
    const footer = fitExactly(
      ` ${key("↑↓")} ${dim("scroll")}  ${key("g/G")} ${dim("top/bottom")}  ${key("Q/Esc")} ${dim("close")}   ${styledFg(t, "muted", position)}`,
      width,
    );

    // Body
    const bodyHeight = Math.max(4, rows - 4);
    if (totalLines === 0) {
      const lines: string[] = [styledFg(t, "muted", "[no output captured]")];
      while (lines.length < bodyHeight) lines.push("");
      return [
        fitExactly(header, width),
        ...this.renderFrame("Output", lines, width, bodyHeight),
        fitExactly(footer, width),
      ];
    }

    // Follow tail if enabled
    if (this.viewerFollowTail) {
      this.viewerScrollTop = Math.max(0, totalLines - bodyHeight);
    }

    const visibleLines = this.viewerOutputLines.slice(this.viewerScrollTop, this.viewerScrollTop + bodyHeight);
    const styledLines = visibleLines.map((line) => styledFg(t, "text", line));
    while (styledLines.length < bodyHeight) styledLines.push("");

    return [
      fitExactly(header, width),
      ...this.renderFrame("Output", styledLines, width, bodyHeight),
      fitExactly(footer, width),
    ];
  }
}
