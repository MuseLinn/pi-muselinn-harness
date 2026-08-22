// Pi + MuseLinn Harness TUI simulator.
// Mirrors the real TUI layout (verified against pi 0.83 + harness 0.9.14):
//   header (quiet startup) → chat + loaded resources → swarm widget →
//   boxed editor (╭╮│╰╯, spinner + model in the top border) → footer with
//   context meter + harness status badges (swarm / permission / goal).
// Braille grid math is ported from packages/core/swarm/widget-lines.ts.

// ── Constants (mirrored from packages/core/swarm/types.ts / helpers.ts) ──
const BRAILLE_EMPTY = '\u28C0';          // ⣀
const BRAILLE_LEVELS = ['\u28C0','\u28C4','\u28E4','\u28E6','\u28F6','\u28F7','\u28FF']; // ⣀⣄⣤⣦⣶⣷⣿
const BRAILLE_BAR_MAX_WIDTH = 8;
const BRAILLE_BAR_MIN_WIDTH = 6;
const STATUS_BAR_CHAR = '\u2501';        // ━
const SUCCESS_MARK = '\u2713 ';          // ✓
const FAILURE_MARK = '\u2717 ';          // ✗
const CANCELLED_MARK = '\u2298 ';        // ⊘
const SPINNER_FRAMES = ['\u280B','\u2819','\u2839','\u2838','\u283C','\u2834','\u2826','\u2827','\u2807','\u280F']; // ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
const FRAME_MS = 80;
const COMPLETE_FILL_MS = 360;
const TERM_W = 84;                       // demo terminal width in characters

// ── Color palette (site theme tokens + sober status hues for the
//    simulated TUI transcript, mirroring the real harness's output) ──
const COLORS = {
  primary:   '#4d6bfe',
  accent:    '#73a3d2',
  text:      '#000000',
  textStrong:'#000000',
  textDim:   '#8c8c8c',
  textMuted: '#8c8c8c',
  border:    '#8c8c8c',
  success:   '#157347',
  warning:   '#9a6700',
  error:     '#cf222e',
  roleUser:  '#4d6bfe',
  shellMode: '#73a3d2',
};

function themedColors() {
  return COLORS;
}

function darkenHexColor(hex, rf, gf, bf) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const d = (ch, f) => Math.max(0, Math.min(255, Math.round(parseInt(ch, 16) * f))).toString(16).padStart(2, '0');
  return `#${d(m[1], rf)}${d(m[2], gf)}${d(m[3], bf)}`;
}

function hexToRgb(hex) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)] : [0,0,0];
}
function lerpColor(a, b, t) {
  return '#' + [0,1,2].map(i => {
    const v = Math.round(a[i] + (b[i] - a[i]) * t);
    return v.toString(16).padStart(2, '0');
  }).join('');
}
function gradientSpan(text, from, to, bias = 1.3) {
  const chars = [...text];
  const f = hexToRgb(from), t = hexToRgb(to);
  if (chars.length <= 1) return `<span style="color:${from};font-weight:800">${text}</span>`;
  return chars.map((ch, i) => {
    const ratio = Math.min(1, (i / (chars.length - 1)) * bias);
    const c = lerpColor(f, t, ratio);
    return `<span style="color:${c};font-weight:800">${ch}</span>`;
  }).join('');
}

// ── Grid layout helpers (from calculateAgentSwarmGridLayout) ──
const TEXT_CELL_PREFERRED_WIDTH = 30;
const TEXT_BRAILLE_BAR_MIN_WIDTH = 6;
const MIN_LABEL_WIDTH = 'Completed'.length; // 9
const CELL_GAP_WIDTH = 2;
const COMPACT_TERMINAL_MARK_WIDTH = 1;

function agentSwarmGridIdWidth(count) {
  return Math.max(3, String(Math.max(1, count)).length);
}
function colsForCellW(width, count, cellW, gapW) {
  if (count <= 1) return count <= 0 ? 0 : 1;
  return Math.max(1, Math.min(count, Math.floor((width + gapW) / (Math.max(1, cellW) + gapW))));
}
function rowsForCols(count, cols) { return count <= 0 ? 0 : Math.ceil(count / Math.max(1, cols)); }
function gridCellW(width, cols, gapW) {
  if (cols <= 0) return 0;
  return Math.max(1, Math.floor((width - gapW * Math.max(0, cols - 1)) / cols));
}
function minTextCellW(idW) { return idW + TEXT_BRAILLE_BAR_MIN_WIDTH + 4 + MIN_LABEL_WIDTH; }
function barCellsForTextCellW(cellW, idW) {
  const fixedW = idW + 1 + 2 + 1 + MIN_LABEL_WIDTH;
  const avail = cellW - fixedW;
  return avail >= TEXT_BRAILLE_BAR_MIN_WIDTH ? Math.min(BRAILLE_BAR_MAX_WIDTH, avail) : TEXT_BRAILLE_BAR_MIN_WIDTH;
}
function compactFixedW(idW) { return idW + 1 + 2; }
function compactCellW(idW, barCells) { return compactFixedW(idW) + Math.max(1, barCells) + COMPACT_TERMINAL_MARK_WIDTH; }
function compactBarCellsForCellW(cellW, idW) {
  return Math.max(1, cellW - compactFixedW(idW) - COMPACT_TERMINAL_MARK_WIDTH);
}
function compactColsForLayout(width, count, height, idW, gapW) {
  const maxC = colsForCellW(width, count, compactCellW(idW, 1), gapW);
  if (height <= 0) return maxC;
  return Math.max(1, Math.min(Math.min(count, Math.ceil(count / height)), maxC));
}
function calculateAgentSwarmGridLayout(count, width, height) {
  if (count === 0) return { renderText: true, barCells: 1, columns: 0, rows: 0, cellWidth: 0 };
  const idW = agentSwarmGridIdWidth(count);
  const gw = CELL_GAP_WIDTH;
  const tc = colsForCellW(width, count, TEXT_CELL_PREFERRED_WIDTH, gw);
  const tr = rowsForCols(count, tc);
  const tw = gridCellW(width, tc, gw);
  if (tr <= height && tw >= minTextCellW(idW)) {
    return { renderText: true, barCells: barCellsForTextCellW(tw, idW), columns: tc, rows: tr, cellWidth: tw, columnGap: gw };
  }
  const ttc = height <= 0 ? count : Math.min(count, Math.ceil(count / height));
  const ttw = gridCellW(width, ttc, gw);
  const ttr = rowsForCols(count, ttc);
  if (height > 0 && ttr <= height && ttw >= minTextCellW(idW)) {
    return { renderText: true, barCells: barCellsForTextCellW(ttw, idW), columns: ttc, rows: ttr, cellWidth: ttw, columnGap: gw };
  }
  const cc = compactColsForLayout(width, count, height, idW, gw);
  const ccw = gridCellW(width, cc, gw);
  const cbc = compactBarCellsForCellW(ccw, idW);
  return { renderText: false, barCells: cbc, columns: cc, rows: rowsForCols(count, cc), cellWidth: compactCellW(idW, cbc), columnGap: gw };
}

// ── Phase labels ──
const PHASE_LABELS = {
  pending:   'Queued...',
  queued:    'Queued...',
  suspended: 'Rate limited...',
  running:   'Working...',
  completed: 'Completed',
  failed:    'Failed',
  cancelled: 'Aborted.',
};

// ── Braille bar helpers (mirrored from widget-lines.ts) ──
function completedDisplayTicks(ticks, phaseElapsedMs, width) {
  const fullBarTicks = width * BRAILLE_LEVELS.length;
  if (phaseElapsedMs === undefined || phaseElapsedMs === null) return Math.max(0, Math.ceil(ticks));
  const fillProgress = Math.min(1, phaseElapsedMs / COMPLETE_FILL_MS);
  return Math.max(0, Math.ceil(ticks + (fullBarTicks - ticks) * fillProgress));
}

function renderAccumulatedBar(ticks, phase, barWidth, colors, phaseElapsedMs) {
  if (phase === 'pending') return '';
  const dotsPerCell = BRAILLE_LEVELS.length;
  const cycleSize = barWidth * dotsPerCell;
  const safeTicks = Math.max(0, Math.ceil(
    phase === 'completed' ? completedDisplayTicks(ticks, phaseElapsedMs, barWidth)
                         : ticks
  ));
  const completedCycles = Math.floor(safeTicks / cycleSize);
  const cycleTicks = safeTicks % cycleSize;

  const filledColor = {
    queued: colors.textDim, suspended: colors.textDim,
    running: colors.success, completed: colors.success,
    failed: colors.error, cancelled: colors.warning,
  }[phase] || colors.textDim;

  const emptyColor = colors.textDim;
  const placeholderColor = phase === 'failed'
    ? darkenHexColor(colors.error, 0.75, 0.25, 0.25)
    : emptyColor;

  let html = '';
  for (let i = 0; i < barWidth; i++) {
    const cellStart = i * dotsPerCell;
    const countThisCycle = Math.max(0, Math.min(dotsPerCell, cycleTicks - cellStart));
    const count = countThisCycle > 0 ? countThisCycle : completedCycles > 0 ? dotsPerCell : 0;
    const ch = count === 0 ? BRAILLE_EMPTY : BRAILLE_LEVELS[count - 1];
    let color;
    if (count === 0) color = placeholderColor;
    else color = filledColor;
    html += `<span style="color:${color}">${ch}</span>`;
  }
  return `<span style="color:${colors.textMuted}">[</span>${html}<span style="color:${colors.textMuted}">]</span>`;
}

// ── Status pip bar ──
function renderPipBar(members, width, colors) {
  const phaseOrder = ['completed','working','suspended','queued','cancelled','failed'];
  const phaseColor = {
    completed: colors.success, working: colors.primary,
    suspended: colors.textMuted, queued: colors.textMuted,
    failed: colors.error, cancelled: colors.warning,
  };
  const counts = {};
  for (const m of members) {
    const p = m.phase === 'running' ? 'working' : m.phase;
    counts[p] = (counts[p] || 0) + 1;
  }
  const entries = phaseOrder.filter(p => (counts[p] || 0) > 0).map(p => ({ phase: p, count: counts[p] }));
  if (entries.length === 0) return `<span style="color:${colors.textMuted}">${STATUS_BAR_CHAR.repeat(width)}</span>`;

  const total = entries.reduce((s, e) => s + e.count, 0);
  let remaining = width;
  return entries.map((e, idx) => {
    const exact = (e.count / total) * width;
    let segW = Math.floor(exact);
    if (idx === entries.length - 1) segW = remaining;
    remaining -= segW;
    const ch = STATUS_BAR_CHAR.repeat(Math.max(0, segW));
    return `<span style="color:${phaseColor[e.phase] || colors.textMuted}">${ch}</span>`;
  }).join('');
}

// ════════════════════════════════════════════════════════════════
// Pi TUI frame renderer — the actual Pi + harness look & feel.
// Verified against a real session (pi 0.83 + harness boxed editor):
//   header  : "pi v0.83.0" + compact onboarding (quiet startup)
//   editor  : ╭─ spinner · working state ──── (provider) model ─╮
//   footer  : context% (mode) · (provider) model • thinking  · badges
// ════════════════════════════════════════════════════════════════
const PiTui = {
  /** Braille spinner frame by index (real harness frames). */
  spinner(frameIdx) {
    return SPINNER_FRAMES[frameIdx % SPINNER_FRAMES.length];
  },

  /** Quiet-startup header block. */
  header(colors) {
    const logo = gradientSpan('pi', colors.primary, colors.accent) +
      `<span style="color:${colors.textDim}"> v0.83.0</span>`;
    const hints = `<span style="color:${colors.textDim}">escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more</span>`;
    const onboarding = `<span style="color:${colors.textMuted}">Press ctrl+o to show full startup help and loaded resources.</span>`;
    return `${logo}\n${hints}\n${onboarding}\n`;
  },

  /** Loaded-resources block (what harness shows on startup). */
  resources(colors) {
    const dim = (s) => `<span style="color:${colors.textDim}">${s}</span>`;
    const head = (s) => `<span style="color:${colors.text}">${s}</span>`;
    return `${head('[Context]')}\n${dim('  AGENTS.md')}\n${head('[Skills]')}\n${dim('  find-skills')}\n${head('[Extensions]')}\n${dim('  dist, pi-muselinn-harness, pi-rtk-optimizer, pi-web-access')}\n`;
  },

  /**
   * Boxed editor — ╭╮│╰╯ with spinner + working state + model in the
   * top border (harness MuselinnEditor "boxed" style).
   */
  boxedEditor(opts, colors) {
    const left = opts.left || '';
    const right = opts.right || '';
    const inner = opts.inner || '';
    const paint = (s) => `<span style="color:${colors.border}">${s}</span>`;
    const innerW = TERM_W - 2;
    const vis = (s) => [...s.replace(/<[^>]*>/g, '')].length;
    const lw = vis(left), rw = vis(right);

    // Top border: ╭─ left ────── right ─╮  (mirrors composeTopBorder)
    const dash = (n) => paint('\u2500'.repeat(Math.max(0, n)));
    let top;
    if (left && right) {
      // Mirrors composeTopBorder: ╭─ left ──fill── right ─╮
      const fill = Math.max(0, innerW - lw - rw - 6);
      top = paint('\u256D') + dash(1) + ' ' + left + ' ' + dash(fill) + ' ' + right + ' ' + dash(1) + paint('\u256E');
    } else if (left) {
      top = paint('\u256D') + dash(1) + ' ' + left + ' ' + dash(Math.max(0, innerW - lw - 5)) + paint('\u256E');
    } else if (right) {
      top = paint('\u256D') + dash(Math.max(0, innerW - rw - 5)) + ' ' + right + ' ' + paint('\u256E');
    } else {
      top = paint('\u256D') + dash(innerW) + paint('\u256E');
    }
    const blank = paint('\u2502') + ' '.repeat(innerW) + paint('\u2502');
    const innerPad = Math.max(0, innerW - 2 - vis(inner));
    // Prompt chevron in the padding slot (real harness: │❯ text │).
    const content = paint('\u2502') + paint('\u276F') + ' ' + inner + ' '.repeat(innerPad) + paint('\u2502');
    const bottom = paint('\u2570') + dash(innerW) + paint('\u256F');
    return `${top}\n${content}\n${blank}\n${bottom}\n`;
  },

  /**
   * Compact editor — single top border with spinner + model (harness
   * "compact" style, pi-spark-like).
   */
  compactEditor(opts, colors) {
    const left = opts.left || '';
    const right = opts.right || '';
    const paint = (s) => `<span style="color:${colors.border}">${s}</span>`;
    const dash = (n) => paint('\u2500'.repeat(Math.max(0, n)));
    const vis = (s) => [...s.replace(/<[^>]*>/g, '')].length;
    let top;
    if (left && right) {
      const lw = vis(left), rw = vis(right);
      const fill = Math.max(0, TERM_W - lw - rw - 2);
      top = dash(1) + ' ' + left + ' ' + dash(fill) + ' ' + right + ' ' + dash(1);
    } else {
      top = dash(TERM_W);
    }
    return `${top}\n`;
  },

  /**
   * Footer — context meter + model + harness status badges.
   * Mirrors: "0.0%/1.0M (auto)   (provider) model • thinking   manual swarm"
   */
  footer(opts, colors) {
    const context = opts.context || '0.0%/1.0M (auto)';
    const model = opts.model || '(opencode-go) deepseek-v4-flash • max';
    const badges = opts.badges || [];
    const left = `<span style="color:${colors.textDim}">${context}</span>` +
      `<span style="color:${colors.textDim}">${' '.repeat(Math.max(1, 24 - [...context].length))}</span>` +
      `<span style="color:${colors.text}">${model}</span>`;
    const badgeHtml = badges.map(b =>
      `<span style="color:${b.color}">${b.text}</span>`
    ).join(' ');
    const pad = ' '.repeat(Math.max(1, TERM_W - [...left.replace(/<[^>]*>/g, '')].length - [...badgeHtml.replace(/<[^>]*>/g, '')].length));
    return `${left}${pad}${badgeHtml}\n`;
  },
};

// ── Simulation state ──
class SwarmSimulator {
  constructor(containerEl, footerEl, opts = {}) {
    this.container = containerEl;
    this.footerEl = footerEl;
    this.agentCount = opts.agentCount || 8;
    this.speed = opts.speed || 1;
    this.members = [];
    this.running = false;
    this.timer = null;
    this.startTime = 0;
    this.elapsedMs = 0;
    this.desc = opts.desc || '8 planets fun facts in parallel';
    this.goalStatus = 'active';
    this.goalTurns = 0;
    this.contextPct = 0;
    this.model = 'deepseek-v4-flash';
    this.provider = 'opencode-go';
    this.thinking = 'max';
  }

  init() {
    this.members = Array.from({ length: this.agentCount }, (_, i) => ({
      id: String(i + 1).padStart(3, '0'),
      phase: 'queued',
      ticks: 0,
      maxTicks: 200 + Math.floor(Math.random() * 400),
      text: '',
      delay: i * 700,
      startTime: 0,
      completedText: '',
      failureText: '',
      phaseStartTime: 0,
    }));
    this.startTime = Date.now();
    this.goalTurns = 0;
    this.contextPct = 0;
  }

  start() {
    this.init();
    this.running = true;
    this.render();
    this.timer = setInterval(() => this.tick(), FRAME_MS);
  }

  stop() {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  tick() {
    const now = Date.now();
    this.elapsedMs = now - this.startTime;
    this.goalTurns = Math.min(7, Math.floor(this.elapsedMs / 3000));
    this.contextPct = Math.min(42.3, this.elapsedMs * 0.005);

    for (const m of this.members) {
      if (m.phase === 'queued') {
        if (this.elapsedMs >= m.delay) {
          m.phase = 'running';
          m.startTime = now;
          m.phaseStartTime = now;
        }
        continue;
      }
      if (m.phase === 'running') {
        m.ticks = Math.min(m.maxTicks, m.ticks + (this.speed * (1 + Math.random() * 2)));
        if (m.ticks >= m.maxTicks) {
          const r = Math.random();
          if (r < 0.05) m.phase = 'failed';
          else if (r < 0.10) m.phase = 'cancelled';
          else m.phase = 'completed';
          m.phaseStartTime = now;
          m.completedText = this.randomCompletedText();
        }
        if (m.phase === 'running' && Math.random() < 0.002) {
          m.phase = 'suspended';
          m.phaseStartTime = now;
          setTimeout(() => {
            if (m.phase === 'suspended') {
              m.phase = 'running';
              m.phaseStartTime = Date.now();
            }
          }, 2000 / this.speed);
        }
      }
    }

    const allDone = this.members.every(m => ['completed','failed','cancelled'].includes(m.phase));
    if (allDone) {
      this.running = false;
      clearInterval(this.timer);
      this.timer = null;
    }
    this.render();
  }

  randomCompletedText() {
    const texts = [
      'Fun fact found!', 'Done.', 'Result ready.', 'Analyzed.',
      'Complete.', 'Summary generated.', 'Facts compiled.', 'Verified.',
    ];
    return texts[Math.floor(Math.random() * texts.length)];
  }

  renderGrid(colors, frameIdx) {
    const w = TERM_W - 2;
    const idW = agentSwarmGridIdWidth(this.agentCount);
    const grid = calculateAgentSwarmGridLayout(this.agentCount, w, 20);
    const { renderText, barCells: bc, columns: cols, rows, cellWidth: cw, columnGap: gapW } = grid;

    let gridHtml = '';
    for (let r = 0; r < rows; r++) {
      let rowHtml = '';
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const m = this.members[idx];
        if (!m) continue;
        const id = `<span style="color:${colors.primary}">${m.id}</span>`;
        const phaseElapsedMs = m.phaseStartTime ? (Date.now() - m.phaseStartTime) : 0;
        const bar = renderAccumulatedBar(
          m.ticks * (bc / m.maxTicks), m.phase, bc, colors, phaseElapsedMs
        );

        let cellContent;
        if (renderText) {
          let label = '';
          if (m.phase === 'running') {
            label = `<span style="color:${colors.textDim}">${PHASE_LABELS.running}</span>`;
          } else if (m.phase === 'completed') {
            label = `<span style="color:${colors.success}">${SUCCESS_MARK}${m.completedText}</span>`;
          } else if (m.phase === 'failed') {
            label = `<span style="color:${colors.error}">${FAILURE_MARK}${m.failureText || PHASE_LABELS.failed}</span>`;
          } else if (m.phase === 'cancelled') {
            label = `<span style="color:${colors.warning}">${CANCELLED_MARK}${PHASE_LABELS.cancelled}</span>`;
          } else if (m.phase === 'suspended') {
            label = `<span style="color:${colors.textDim}">Rate limited...</span>`;
          } else {
            label = `<span style="color:${colors.textDim}">${PHASE_LABELS[m.phase]}</span>`;
          }
          // Pad to the cell width so rows stay visually aligned.
          const cellVis = [...`${m.id} ${bar.replace(/<[^>]*>/g, '')} ${label.replace(/<[^>]*>/g, '')}`].length;
          const pad = ' '.repeat(Math.max(0, cw - cellVis));
          cellContent = `${id} ${bar} ${label}${pad}`;
        } else {
          let mark = '';
          if (m.phase === 'completed') mark = `<span style="color:${colors.success}">${SUCCESS_MARK.trim()}</span>`;
          else if (m.phase === 'failed') mark = `<span style="color:${colors.error}">${FAILURE_MARK.trim()}</span>`;
          else if (m.phase === 'cancelled') mark = `<span style="color:${colors.warning}">${CANCELLED_MARK.trim()}</span>`;
          cellContent = `${id} ${bar}${mark}`;
        }
        rowHtml += `<span style="display:inline-block;min-width:${cw}ch;margin-right:${gapW}ch">${cellContent}</span>`;
      }
      gridHtml += rowHtml + '\n';
    }
    return gridHtml;
  }

  render() {
    const colors = themedColors();
    const frameIdx = Math.floor(Date.now() / 80);

    // Agent swarm invocation in the chat (model-callable tool).
    const active = this.members.filter(m => m.phase === 'running').length;
    const done = this.members.filter(m => m.phase === 'completed').length;
    const failed = this.members.filter(m => m.phase === 'failed').length;
    const total = this.members.length;

    // Widget status line (mirrors widget-lines.ts: spin + label + pip bar)
    let statusLabel, statusColor;
    if (this.running && active > 0) { statusLabel = 'Working...'; statusColor = colors.primary; }
    else if (!this.running && failed > 0 && done === 0) { statusLabel = 'Failed.'; statusColor = colors.error; }
    else if (!this.running) { statusLabel = 'Completed.'; statusColor = colors.success; }
    else { statusLabel = 'Working...'; statusColor = colors.primary; }
    const pipWidth = Math.max(0, TERM_W - 2 - statusLabel.length - 4);
    const statusLine = ` <span style="color:${statusColor}">${statusLabel}</span>  ${renderPipBar(this.members, pipWidth, colors)}`;

    // Editor left slot: spinner + working state (harness slotLeft).
    const spinner = `<span style="color:${colors.accent}">${PiTui.spinner(frameIdx)}</span>`;
    const workLabel = this.running
      ? `<span style="color:${colors.textDim}">Running tools</span>`
      : `<span style="color:${colors.textDim}">Idle</span>`;
    const editorLeft = `${spinner} ${workLabel}`;
    const editorRight = `<span style="color:${colors.textDim}">(${this.provider}) ${this.model}</span>`;

    // Editor inner: the user's invocation.
    const editorInner = this.running
      ? `agent_swarm: ${this.desc}`
      : '';

    // Footer badges (harness status bar): permission-mode + swarm + count.
    const badges = [
      { text: 'manual', color: colors.warning },
      { text: 'swarm', color: colors.accent },
    ];
    if (this.running) {
      badges.push({ text: `[${active} agents running]`, color: colors.primary });
    } else if (!this.running && (done > 0 || failed > 0)) {
      badges.push({ text: `[${done}/${total} done]`, color: colors.success });
    }

    // Context meter climbing with progress.
    const contextPct = Math.min(42.3, this.contextPct).toFixed(1);

    // Assemble the full Pi TUI frame.
    const header = PiTui.header(colors);
    const resources = PiTui.resources(colors);
    const userLine = `<span style="color:${colors.roleUser}">  you: </span><span style="color:${colors.text}">run the swarm — ${this.desc}</span>\n`;

    let widgetBlock = '';
    if (this.running || done > 0 || failed > 0) {
      const gridHtml = this.renderGrid(colors, frameIdx);
      widgetBlock = `${gridHtml}${statusLine}\n\n`;
    }

    const editor = PiTui.boxedEditor({ left: editorLeft, right: editorRight, inner: editorInner }, colors);
    const footer = PiTui.footer({
      context: `${contextPct}%/1.0M (auto)`,
      model: `(${this.provider}) ${this.model}`,
      badges,
    }, colors);

    this.container.innerHTML = `<pre style="margin:0;white-space:pre;line-height:1.5">${header}\n${resources}\n${userLine}${widgetBlock}${editor}${footer}</pre>`;
    if (this.footerEl) this.footerEl.innerHTML = '';
  }
}

// Expose for the typewriter scenes in main.js.
if (typeof window !== 'undefined') {
  window.SwarmSimulator = SwarmSimulator;
  window.PiTui = PiTui;
  window.PiDemoTermW = TERM_W;
}
