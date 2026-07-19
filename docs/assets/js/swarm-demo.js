// Extracted from kimi-code-tui (Kimi Code TUI showcase): braille swarm grid simulator.
// Mirrors kimi-code/apps/kimi-code/src/tui/components/messages/agent-swarm-progress.ts

// ── Constants (mirrored from agent-swarm-progress.ts) ──
const BRAILLE_EMPTY = '\u28C0';          // ⣀ (bottom dots, visible in browser)
const BRAILLE_LEVELS = ['\u28C0','\u28C4','\u28E4','\u28E6','\u28F6','\u28F7','\u28FF']; // ⣀⣄⣤⣦⣶⣷⣿
const BRAILLE_RIGHT_FULL = '\u2838';     // ⢸
const STATUS_BAR_CHAR = '\u2501';        // ━
const SUCCESS_MARK = '\u2713 ';          // ✓
const FAILURE_MARK = '\u2717 ';          // ✗
const CANCELLED_MARK = '\u2298 ';        // ⊘
const FRAME_MS = 80;
const COMPLETE_FILL_MS = 360;

// ── Color palette (mirrored from colors.ts) ──
const COLORS = {
  primary:   '#4FA8FF',
  accent:    '#5BC0BE',
  text:      '#E0E0E0',
  textStrong:'#F5F5F5',
  textDim:   '#888888',
  textMuted: '#6B6B6B',
  border:    '#5A5A5A',
  success:   '#4EC87E',
  warning:   '#E8A838',
  error:     '#E85454',
  roleUser:  '#FFCB6B',
  shellMode: '#BD93F9',
};

// Light-theme counterpart — picked per render so theme toggles apply live.
const LIGHT_COLORS = {
  primary:   '#3b6fd4',
  accent:    '#1f8a87',
  text:      '#394352',
  textStrong:'#17202e',
  textDim:   '#6b7688',
  textMuted: '#8a94a6',
  border:    '#d4dbe6',
  success:   '#1e9e57',
  warning:   '#b57d1f',
  error:     '#d33f3f',
  roleUser:  '#b57d1f',
  shellMode: '#7c4dbd',
};

function themedColors() {
  const root = typeof document !== 'undefined' ? document.documentElement : null;
  const light = root && root.getAttribute('data-theme') === 'light';
  return light ? LIGHT_COLORS : COLORS;
}

// ── Grid layout constants (from source calculateAgentSwarmGridLayout) ──
const TEXT_CELL_PREFERRED_WIDTH = 30;
const TEXT_BRAILLE_BAR_MIN_WIDTH = 6;
const BRAILLE_BAR_MAX_WIDTH = 8;
const MIN_LABEL_WIDTH = 'Completed'.length; // 9
const CELL_GAP_WIDTH = 2;
const COMPACT_TERMINAL_MARK_WIDTH = 1;

// ── Grid layout helpers ──
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
  // Try text mode with preferred width
  const tc = colsForCellW(width, count, TEXT_CELL_PREFERRED_WIDTH, gw);
  const tr = rowsForCols(count, tc);
  const tw = gridCellW(width, tc, gw);
  if (tr <= height && tw >= minTextCellW(idW)) {
    return { renderText: true, barCells: barCellsForTextCellW(tw, idW), columns: tc, rows: tr, cellWidth: tw, columnGap: gw };
  }
  // Try targeted columns to fit height
  const ttc = height <= 0 ? count : Math.min(count, Math.ceil(count / height));
  const ttw = gridCellW(width, ttc, gw);
  const ttr = rowsForCols(count, ttc);
  if (height > 0 && ttr <= height && ttw >= minTextCellW(idW)) {
    return { renderText: true, barCells: barCellsForTextCellW(ttw, idW), columns: ttc, rows: ttr, cellWidth: ttw, columnGap: gw };
  }
  // Compact mode
  const cc = compactColsForLayout(width, count, height, idW, gw);
  const ccw = gridCellW(width, cc, gw);
  const cbc = compactBarCellsForCellW(ccw, idW);
  return { renderText: false, barCells: cbc, columns: cc, rows: rowsForCols(count, cc), cellWidth: compactCellW(idW, cbc), columnGap: gw };
}
function darkenHexColor(hex, rf, gf, bf) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const d = (ch, f) => Math.max(0, Math.min(255, Math.round(parseInt(ch, 16) * f))).toString(16).padStart(2, '0');
  return `#${d(m[1], rf)}${d(m[2], gf)}${d(m[3], bf)}`;
}

// ── Phase labels ──
const PHASE_LABELS = {
  pending:   'Queued...',
  queued:    'Queued...',
  suspended: 'Rate limited...',
  running:   'Running',
  completed: 'Completed',
  failed:    'Failed',
  cancelled: 'Aborted.',
};

// ── Gradient text renderer ──
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

// ── Braille bar helpers ──
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
    if (count === 0) {
      color = placeholderColor;
    } else {
      color = filledColor;
    }
    html += `<span style="color:${color}">${ch}</span>`;
  }
  return `<span style="color:${colors.textMuted}">[</span>${html}<span style="color:${colors.textMuted}">]</span>`;
}

// ── Braille bar renderer (wraps renderAccumulatedBar for legacy use) ──
function renderBrailleBar(ticks, phase, width, colors, phaseElapsedMs) {
  return renderAccumulatedBar(ticks, phase, width, colors, phaseElapsedMs);
}

// ── Status pip bar renderer ──
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
    this.model = 'kimi-k2.5';
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
        // 模拟偶尔的 suspended 状态
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

    // Check if all done
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

  render() {
    const COLORS = themedColors();
    const w = 84;
    const idW = agentSwarmGridIdWidth(this.agentCount);
    const grid = calculateAgentSwarmGridLayout(this.agentCount, w, 20);
    const { renderText, barCells: bc, columns: cols, rows, cellWidth: cw, columnGap: gapW } = grid;

    // Header
    const header = gradientSpan('Agent Swarm', COLORS.primary, COLORS.accent) +
      ` <span style="color:${COLORS.primary}"> ─ </span><span style="color:${COLORS.text}">${this.desc}</span>`;

    // Render grid using calculated layout
    let gridHtml = '';
    for (let r = 0; r < rows; r++) {
      let rowHtml = '';
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const m = this.members[idx];
        if (!m) continue;
        const id = `<span style="color:${COLORS.primary}">${m.id}</span>`;
        const phaseElapsedMs = m.phaseStartTime ? (Date.now() - m.phaseStartTime) : 0;
        const bar = renderAccumulatedBar(
          m.ticks * (bc / m.maxTicks), m.phase, bc, COLORS, phaseElapsedMs
        );

        let cellContent;
        if (renderText) {
          // Text mode: id + [bar] + space + label
          let label = '';
          if (m.phase === 'running') {
            label = `<span style="color:${COLORS.textDim}">${PHASE_LABELS.running}</span>`;
          } else if (m.phase === 'completed') {
            label = `<span style="color:${COLORS.success}">${SUCCESS_MARK}${m.completedText}</span>`;
          } else if (m.phase === 'failed') {
            label = `<span style="color:${COLORS.error}">${FAILURE_MARK}${m.failureText || PHASE_LABELS.failed}</span>`;
          } else if (m.phase === 'cancelled') {
            label = `<span style="color:${COLORS.warning}">${CANCELLED_MARK}${PHASE_LABELS.cancelled}</span>`;
          } else if (m.phase === 'suspended') {
            label = `<span style="color:${COLORS.textDim}">Rate limited...</span>`;
          } else {
            label = `<span style="color:${COLORS.textDim}">${PHASE_LABELS[m.phase]}</span>`;
          }
          cellContent = `${id} ${bar} ${label}`;
        } else {
          // Compact mode: id + [bar] + terminalMark
          let mark = '';
          if (m.phase === 'completed') mark = `<span style="color:${COLORS.success}">${SUCCESS_MARK.trim()}</span>`;
          else if (m.phase === 'failed') mark = `<span style="color:${COLORS.error}">${FAILURE_MARK.trim()}</span>`;
          else if (m.phase === 'cancelled') mark = `<span style="color:${COLORS.warning}">${CANCELLED_MARK.trim()}</span>`;
          cellContent = `${id} ${bar}${mark}`;
        }
        rowHtml += `<span style="display:inline-block;min-width:${cw}ch;margin-right:${gapW}ch">${cellContent}</span>`;
      }
      gridHtml += rowHtml + '\n';
    }

    // Status line with pip bar
    const active = this.members.filter(m => m.phase === 'running').length;
    const done = this.members.filter(m => m.phase === 'completed').length;
    const failed = this.members.filter(m => m.phase === 'failed').length;
    let statusLabel = '';
    let statusColor = COLORS.primary;
    if (this.running && active > 0) {
      statusLabel = 'Working...';
      statusColor = done > 0 ? COLORS.success : COLORS.primary;
    } else if (!this.running) {
      if (failed > 0 && done === 0) { statusLabel = 'Failed.'; statusColor = COLORS.error; }
      else { statusLabel = 'Completed.'; statusColor = COLORS.success; }
    } else {
      statusLabel = 'Working...';
      statusColor = COLORS.primary;
    }
    const pipWidth = Math.max(0, w - statusLabel.length - 4);
    const statusLine = ` <span style="color:${statusColor}">${statusLabel}</span>  ${renderPipBar(this.members, pipWidth, COLORS)}`;

    // Footer
    this.renderFooter();

    // Assemble
    this.container.innerHTML = `<pre style="margin:0;white-space:pre;line-height:1.5">${header}\n\n${gridHtml}\n${statusLine}\n</pre>`;
  }

  renderFooter() {
    if (!this.footerEl) return;
    const COLORS = themedColors();
    const elapsed = Math.floor(this.elapsedMs / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const timeStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;

    const total = this.members.length;
    const done = this.members.filter(m => m.phase === 'completed').length;
    const failed = this.members.filter(m => m.phase === 'failed').length;
    const cancelled = this.members.filter(m => m.phase === 'cancelled').length;
    const active = this.members.filter(m => m.phase === 'running').length;
    this.contextPct = Math.min(95, (done + failed + cancelled) / total * 60 + this.elapsedMs * 0.003);

    // Goal status
    let goalStatus = 'active';
    let goalColor = COLORS.primary;
    if (!this.running) {
      goalStatus = 'complete';
      goalColor = COLORS.success;
    } else if (active === 0 && this.running) {
      goalStatus = 'paused';
      goalColor = COLORS.textMuted;
    }

    // Activity prefix: working→braille spinner, completed→✓, failed→✗, aborted→⊘
    let activityPrefix = '';
    if (this.running) {
      const spinnerFrames = ['\u280B','\u2819','\u2839','\u2838','\u283C','\u2834','\u2826','\u2827','\u2807','\u280F'];
      const frameIdx = Math.floor(Date.now() / 80) % spinnerFrames.length;
      activityPrefix = `<span style="color:${COLORS.primary}">${spinnerFrames[frameIdx]}</span> `;
    } else if (failed > 0 && done === 0) {
      activityPrefix = `<span style="color:${COLORS.error}">${FAILURE_MARK.trim()}</span> `;
    } else if (!this.running) {
      activityPrefix = `<span style="color:${COLORS.success}">${SUCCESS_MARK.trim()}</span> `;
    }

    const goalBadge = `${activityPrefix}<span style="color:${COLORS.textMuted}">[goal </span><span style="color:${goalColor}">\u25CF</span><span style="color:${COLORS.textMuted}"> ${goalStatus} \u00B7 ${timeStr} \u00B7 ${this.goalTurns} turns]</span>`;
    const modelLabel = `<span style="color:${COLORS.text}">${this.model} thinking</span>`;
    const gitBadge = `<span style="color:${COLORS.textDim}">main</span>`;
    const taskBadge = active > 0 ? `<span style="color:${COLORS.primary}">[${active} agents running]</span>` : '';

    // Line 2: background tip on the left, context meter right-aligned —
    // keeps both lines within 84ch so nothing wraps in the demo frame.
    const tipText = 'ctrl+b run in background';
    const contextText = `context: ${this.contextPct.toFixed(1)}% (${(this.contextPct * 2).toFixed(0)}k/200k)`;
    const pad = Math.max(1, 84 - tipText.length - contextText.length);
    const line2 = `<span style="color:${COLORS.textMuted}">${tipText}${' '.repeat(pad)}</span><span style="color:${COLORS.text}">${contextText}</span>`;

    this.footerEl.innerHTML =
      `<div class="footer-line">${goalBadge}  ${modelLabel}  ${gitBadge}  ${taskBadge}</div>` +
      `<div class="footer-line">${line2}</div>`;
  }
}

// ── Gradient demo renderer ──
