/* pi-style-web: lang toggle + scroll reveal + demo scenes + copy button */
(function () {
  var root = document.documentElement;

  // ── Language toggle (EN/中) ──
  function currentLang() {
    return root.getAttribute("data-lang") === "zh" ? "zh" : "en";
  }
  function setLang(lang) {
    root.setAttribute("data-lang", lang);
    // Keep the document language in sync for assistive tech.
    root.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    try { localStorage.setItem("lang", lang); } catch (e) { /* ok */ }
    var btn = document.getElementById("lang-toggle");
    if (btn) {
      btn.textContent = lang === "zh" ? "EN" : "中";
      btn.setAttribute("aria-label", lang === "zh" ? "Switch to English" : "切换到中文");
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    // lang
    var langBtn = document.getElementById("lang-toggle");
    if (langBtn) {
      langBtn.textContent = currentLang() === "zh" ? "EN" : "中";
      langBtn.setAttribute("aria-label", currentLang() === "zh" ? "Switch to English" : "切换到中文");
      langBtn.addEventListener("click", function () {
        setLang(currentLang() === "zh" ? "en" : "zh");
      });
    }

    // install command copy button
    var copyBtn = document.getElementById("install-copy");
    if (copyBtn) {
      var CMD = "pi install npm:pi-muselinn-harness";
      var LABELS = {
        copy: '<span data-l="en">Copy</span><span data-l="zh">复制</span>',
        done: '<span data-l="en">Copied ✓</span><span data-l="zh">已复制 ✓</span>',
      };
      var resetTimer = null;
      function flashCopied() {
        copyBtn.classList.add("copied");
        copyBtn.innerHTML = LABELS.done;
        if (resetTimer) clearTimeout(resetTimer);
        resetTimer = setTimeout(function () {
          copyBtn.classList.remove("copied");
          copyBtn.innerHTML = LABELS.copy;
        }, 1800);
      }
      function legacyCopy() {
        var ta = document.createElement("textarea");
        ta.value = CMD;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) { /* no-op */ }
        document.body.removeChild(ta);
        flashCopied();
      }
      copyBtn.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(CMD).then(flashCopied, legacyCopy);
        } else {
          legacyCopy();
        }
      });
    }

    // scroll reveal
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var els = document.querySelectorAll(".reveal");
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("visible"); });
    } else {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: "0px 0px -24px 0px" });
      els.forEach(function (el) { io.observe(el); });
    }


    // Restart the typewriter scene whenever the system color scheme flips,
    // so the demo colors stay in sync without a reload.
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (runningScene) startTypeScene(runningScene);
      if (swarm) { swarm.stop(); swarm.start(); }
    });
    initScenes();
    initScrollProgress();
  });

  // ── Demo scenes (sticky terminal) ──
  // Architecture follows pi.dev's home-inline.js:
  //  - One scroll progress --p (0 -> 1 over ~300px) written by a rAF
  //    scroll listener; all geometry interpolates via CSS calc().
  //  - The terminal shows a "$ scroll to continue" cue until the first
  //    scroll (pi.dev's shouldAutoplayMainDemo: scrollY > 1).
  //  - Prose reveals on --sp = (--p - 0.8) / 0.2 — only once the
  //    terminal is ~80% docked.
  //  - The active section owns the scene; it is the last section whose
  //    title anchor (50% of its height) has passed the activation line
  //    (70% of the terminal frame height), else the first visible one.
  var bodyEl, titleEl, shell, term, sectionsWrap;
  var sectionEls = [];
  var swarm = null, swarmRestart = null, typeTimer = null;
  var currentScene = null, runningScene = null;
  var unlocked = false, lastP = 0;
  var wide = window.matchMedia("(min-width: 761px)");

  var CUE_HTML =
    '<span class="scroll-cue"><span class="prompt">$</span>' +
    '<span data-l="en">scroll to continue</span><span data-l="zh">滚动继续</span>' +
    '<span class="cue-caret">▍</span></span>';

  function clamp01(v) { return Math.min(1, Math.max(0, v)); }

  function getScrollRange() {
    var w = window.innerWidth;
    if (w <= 767) return 220;
    if (w <= 1023) return 260;
    return 300;
  }

  function stopScene() {
    if (swarm) { swarm.stop(); swarm = null; }
    if (swarmRestart) { clearTimeout(swarmRestart); swarmRestart = null; }
    if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; }
  }

  function setTitle(t) { if (titleEl) titleEl.textContent = t; }

  // ── Scroll progress (pi.dev intro controller) ──
  function updateGeometry() {
    if (!wide.matches) {
      shell.style.setProperty("--dx", "0px");
    }
    var nav = document.querySelector(".topnav");
    var navH = nav ? nav.getBoundingClientRect().height : 0;
    // Parent (.split-term) is sticky and untransformed — its rect is the
    var pr = term.parentElement.getBoundingClientRect();
    var cx = pr.left + pr.width / 2;
    if (wide.matches) {
      shell.style.setProperty("--dx", Math.round(window.innerWidth / 2 - cx) + "px");
    }
    // Sticky top that parks the terminal vertically centered in the
    // viewport (pi.dev's --home-stage-sticky-top-target).
    var figH = term.offsetHeight || 0;
    var centerY = navH + (window.innerHeight - navH) / 2;
    var stickyTop = Math.max(navH + 8, Math.round(centerY - figH / 2));
    shell.style.setProperty("--sticky-top", stickyTop + "px");
  }

  function updateProgress() {
    if (!shell) return;
    var p = wide.matches ? clamp01(window.scrollY / getScrollRange()) : 1;
    var sp = wide.matches ? clamp01((p - 0.8) / 0.2) : 1;
    lastP = p;
    shell.style.setProperty("--p", p.toFixed(4));
    shell.style.setProperty("--sp", sp.toFixed(4));
    if (sectionsWrap) sectionsWrap.classList.toggle("is-visible", sp > 0.001);
    updateUnlock();
    updateActiveSection();
  }

  function initScrollProgress() {
    shell = document.getElementById("split");
    term = document.getElementById("demo-term");
    sectionsWrap = document.querySelector(".split-sections");
    if (!shell || !term) return;

    var pending = false;
    function onScroll() {
      // rAF is paused in hidden tabs — run synchronously there so the
      // progress vars never go stale (also covers headless testing).
      if (document.hidden) { updateProgress(); return; }
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; updateProgress(); });
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", function () { updateGeometry(); updateProgress(); });
    if (wide.addEventListener) {
      wide.addEventListener("change", function () { updateGeometry(); updateProgress(); });
    }
    updateGeometry();
    updateProgress();
  }

  // ── Terminal unlock: cue first, demo after the first scroll ──
  function updateUnlock() {
    var should = !wide.matches || window.scrollY > 1;
    if (should === unlocked) return;
    unlocked = should;
    if (!bodyEl) return;
    if (unlocked) {
      startScene(currentScene || "swarm", true);
    } else {
      stopScene();
      runningScene = null;
      setTitle("swarm · live");
      bodyEl.innerHTML = CUE_HTML;
    }
  }

  // ── Active section (pi.dev's activation-line algorithm) ──
  function updateActiveSection() {
    if (!sectionEls.length || !term) return;
    var frameTop, frameH;
    if (wide.matches) {
      // Resolve the frame to its sticky resting line, not its transient
      // transform position (scale error is negligible once --p > 0.8,
      // which is the only time sections are visible).
      var stickyTop = parseFloat(shell.style.getPropertyValue("--sticky-top")) || 72;
      frameTop = stickyTop + (1 - lastP) * 16;
      frameH = term.offsetHeight || 400;
    } else {
      var tr = term.getBoundingClientRect();
      frameTop = tr.top;
      frameH = tr.height;
    }
    var line = frameTop + frameH * 0.35;
    var active = null, firstVisible = null;
    for (var i = 0; i < sectionEls.length; i++) {
      var s = sectionEls[i];
      var r = s.getBoundingClientRect();
      if (!firstVisible && r.bottom > 0 && r.top < window.innerHeight) firstVisible = s;
      var h = s.querySelector("h3") || s;
      var hr = h.getBoundingClientRect();
      if (hr.top + hr.height * 0.5 <= line) active = s;
      else if (active) break;
    }
    var target = active || firstVisible || sectionEls[0];
    for (var j = 0; j < sectionEls.length; j++) {
      sectionEls[j].classList.toggle("is-active", sectionEls[j] === target);
    }
    if (target) setScene(target.getAttribute("data-scene"));
  }

  // ── Scene lifecycle ──
  function setScene(name) {
    currentScene = name;
    if (!unlocked || !bodyEl || runningScene === name) return;
    startScene(name, false);
  }

  function startScene(name, instant) {
    if (!bodyEl) return;
    runningScene = name;
    if (instant) {
      stopScene();
      bodyEl.innerHTML = "";
      if (name === "swarm") startSwarmScene();
      else startTypeScene(name);
      return;
    }
    // Crossfade between scenes instead of a hard swap.
    bodyEl.classList.add("fading");
    setTimeout(function () {
      if (runningScene !== name) return;
      stopScene();
      bodyEl.innerHTML = "";
      bodyEl.classList.remove("fading");
      if (name === "swarm") startSwarmScene();
      else startTypeScene(name);
    }, 170);
  }

  function startSwarmScene() {
    setTitle("swarm · live");
    bodyEl.innerHTML = "";
    var pre = document.createElement("div");
    var foot = document.createElement("div");
    foot.className = "demo-footer";
    bodyEl.appendChild(pre);
    bodyEl.appendChild(foot);
    function run() {
      swarm = new SwarmSimulator(pre, foot, { agentCount: 8, speed: 2.2, desc: "8 parallel subagents · live simulation" });
      swarm.start();
      swarmRestart = setTimeout(run, 26000); // loop the demo
    }
    run();
  }

  var TYPE_SCENES = {
    goal: {
      title: "goal · lifecycle",
      tag: "goal",
      lines: [
        ["cmd", "$ /goal Ship v0.8 with all 269 tests green"],
        ["dim", "  context injected: <untrusted_objective>"],
        ["dim", "  working through the queue..."],
        ["ok",  "✓ criterion verified: tests 269/269 green"],
        ["ok",  "● Goal: complete · 14 turns · 6m12s"],
      ],
    },
    plan: {
      title: "plan · read-only first",
      planBadge: true,
      lines: [
        ["cmd", "$ /plan Refactor the renderer into modules"],
        ["dim", "  plan mode: write tools restricted to plan file"],
        ["dim", "  exploring: tui/box.ts, tui/editor.ts, swarm/widget.ts"],
        ["ok",  "  plan written → .pi/plans/PLAN.md"],
        ["cmd", "$ exit_plan_mode (approve)"],
        ["ok",  "✓ plan approved — execution unlocked"],
      ],
    },
    permission: {
      title: "permission · 18-level chain",
      lines: [
        ["cmd", "$ git push --force origin main"],
        ["warn","⚠ destructive command detected — approval required"],
        ["dim", "  policy: destructive-ask-always (never short-circuited)"],
        ["dim", "  ── approval dialog ──"],
        ["dim", "  1) Allow once  2) Always allow  3) Deny  4) Deny with reason"],
        ["cmd", "$ cat .env"],
        ["err", "✗ blocked: sensitive file guard (.env)"],
        ["dim", "  mode: yolo — safety policies run before mode rules"],
      ],
    },
    hooks: {
      title: "hooks + skills",
      lines: [
        ["dim", "[[hooks]] event=PreToolUse matcher=\"Bash\""],
        ["cmd", "$ ~/.kimi-code/hooks/guard.sh"],
        ["ok",  "  exit 0 → allow (stdout appended as context)"],
        ["dim", "[[hooks]] event=Stop"],
        ["warn","  exit 2 → blocked: \"269 tests not green yet\""],
        ["dim", "skills: 7 scopes scanned · collisions deduped · 0 diagnostics"],
      ],
    },
    tui: {
      title: "tui · boxed editor",
      switchCompact: true,
      lines: [
        ["box", "tell me about the swarm module"],
        ["cmd", "$ /tui style compact"],
        ["dim", "  editor chrome: boxed → compact (hot-swap, no restart)"],
        ["box", "─ ⣾ Running tools ──────── (opencode-go) deepseek-v4-flash ─"],
        ["cmd", "$ /tui timing"],
        ["dim", "  editor: n=240 mean=0.31ms p50=0.28ms p99=1.2ms"],
      ],
    },
    pause: {
      title: "pause · freeze & steer",
      tag: "swarm",
      lines: [
        ["cmd", "$ /pause"],
        ["dim", "  ⏸ PAUSED — agents hold at their next safe boundary"],
        ["dim", "  <tool_call> · in-flight calls finish; nothing new starts"],
        ["dim", "  paused for 0:14 · esc/enter/space/ctrl+c 释放"],
        ["cmd", "$ /steer 002 只看 tests/ 目录"],
        ["ok",  "  ✓ steered 002 — transcript reflects the new direction"],
        ["dim", "  agents/002/wire.jsonl · c = conversation view"],
      ],
    },
  };

  var TYPE_COLORS = {
    light: {
      cmd: "#4d6bfe", ok: "#157347", dim: "#8c8c8c",
      warn: "#9a6700", err: "#cf222e", box: "#73a3d2",
      text: "#000000",
    },
    dark: {
      cmd: "#6d86ff", ok: "#2ea043", dim: "#8b93a5",
      warn: "#d29922", err: "#f85149", box: "#73a3d2",
      text: "#e6e9ef",
    },
  };
  function currentTypeColors() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? TYPE_COLORS.dark
      : TYPE_COLORS.light;
  }

  function typeColor(kind) {
    return currentTypeColors()[kind] || "#e6e9ef";
  }

  // ── Full Pi TUI frame for typewriter scenes ──
  // header (quiet startup) + chat lines + boxed/compact editor + footer
  // with harness badges. Mirrors what a real session shows.
  function tuiFrame(scene, chatHtml, editorStyle, colors, goalComplete) {
    var vis = function (s) { return s.replace(/<[^>]*>/g, "").length; };
    var dim = function (s) { return '<span style="color:' + colors.dim + '">' + s + '</span>'; };
    var accent = function (s) { return '<span style="color:' + colors.box + '">' + s + '</span>'; };
    var textDim = function (s) { return '<span style="color:' + colors.dim + '">' + s + '</span>'; };

    var header = accent("pi") + '<span style="color:' + colors.dim + '"> v0.83.0</span>\n' +
      dim("escape interrupt · ctrl+c/ctrl+d clear/exit · / commands · ! bash · ctrl+o more") + "\n" +
      dim("Press ctrl+o to show full startup help and loaded resources.") + "\n";

    var body = chatHtml;

    // Editor
    var spinner = "\u280B"; // ⠋ (static in type scenes)
    var left = accent(spinner + " ") + dim("Idle");
    var right = dim("(opencode-go) deepseek-v4-flash");
    var W = window.PiDemoTermW || 84;
    // Visible widths of the border slots (HTML stripped) — required for
    // the dash fills below; without them the frame corners misalign.
    var lw = vis(left), rw = vis(right);
    var paint = function (s) { return '<span style="color:' + colors.dim + '">' + s + '</span>'; };
    var dash = function (n) { return paint("\u2500".repeat(Math.max(0, Math.floor(n)))); };

    var editorHtml;
    if (editorStyle === "compact") {
      var fillC = Math.max(0, W - lw - rw - 6);
      editorHtml = dash(1) + " " + left + " " + dash(fillC) + " " + right + " " + dash(1) + "\n";
    } else {
      var innerW = W - 2;
      var fill2 = Math.max(0, innerW - lw - rw - 6);
      var top = paint("\u256D") + dash(1) + " " + left + " " + dash(fill2) + " " + right + " " + dash(1) + paint("\u256E");
      var blank = paint("\u2502") + " ".repeat(innerW) + paint("\u2502");
      var bottom = paint("\u2570") + dash(innerW) + paint("\u256F");
      // Prompt chevron on the first content line (real harness: │❯ text │).
      blank = paint("\u2502") + paint("\u276F") + " ".repeat(innerW - 1) + paint("\u2502");
      editorHtml = top + "\n" + blank + "\n" + bottom + "\n";
    }

    // Footer + badges: permission mode always; one scene-specific badge.
    var badges = [
      '<span style="color:' + colors.warn + '">manual</span>',
    ];
    if (scene.tag === "goal") {
      badges.push(goalComplete
        ? '<span style="color:' + colors.ok + '">[goal ● complete]</span>'
        : '<span style="color:' + colors.box + '">[goal ● active]</span>');
    } else if (scene.planBadge) {
      badges.push('<span style="color:' + colors.warn + '">plan</span>');
    } else if (scene.tag === "swarm") {
      badges.push('<span style="color:' + colors.box + '">swarm</span>');
    }
    var footerLeft = textDim("0.0%/1.0M (auto)");
    var footerMid = '<span style="color:' + colors.text + '">(opencode-go) deepseek-v4-flash</span>';
    var badgeStr = badges.join(" ");
    var used = footerLeft.replace(/<[^>]*>/g, "").length + footerMid.replace(/<[^>]*>/g, "").length + badgeStr.replace(/<[^>]*>/g, "").length;
    var pad = Math.max(1, W - used);
    var footer = footerLeft + " " + footerMid + " ".repeat(pad) + badgeStr + "\n";

    return header + "\n" + body + editorHtml + footer;
  }

  function startTypeScene(name) {
    var scene = TYPE_SCENES[name];
    if (!scene) return;
    setTitle(scene.title);
    bodyEl.innerHTML = "";
    var pre = document.createElement("pre");
    pre.className = "demo-pre";
    bodyEl.appendChild(pre);
    var colors = currentTypeColors();

    var chatLines = []; // [{kind, text}] accumulated so far
    var li = 0, ci = 0, cur = null;
    var compact = false;
    var goalDone = false; // per-playthrough state — never mutated on TYPE_SCENES

    function render() {
      var chatHtml = chatLines.map(function (l) {
        return '<span style="color:' + typeColor(l.kind) + '">' + l.text + "</span>\n";
      }).join("");
      if (cur) {
        chatHtml += '<span style="color:' + typeColor(chatLines.length ? cur.kind : "cmd") + '">' + cur.text + "</span>";
      }
      pre.innerHTML = tuiFrame(scene, chatHtml, compact ? "compact" : "boxed", colors, goalDone);
    }

    function step() {
      if (li >= scene.lines.length) {
        // Goal badge flips to complete only for the rest of this playthrough.
        goalDone = true;
        render();
        typeTimer = setTimeout(function () {
          if (runningScene === name) startTypeScene(name);
        }, 7000);
        return;
      }
      var kind = scene.lines[li][0];
      var text = scene.lines[li][1];
      if (kind === "box") {
        // Box lines land in the editor border area — for the tui scene they
        // just render as chat lines styled with the accent color.
        chatLines.push({ kind: "box", text: text });
        li++;
        render();
        typeTimer = setTimeout(step, 260);
        return;
      }
      if (kind === "cmd") {
        // Commands type out; everything else appears instantly.
        if (!cur) { cur = { kind: kind, text: "" }; ci = 0; }
        cur.text = text.slice(0, ++ci);
        render();
        if (ci >= text.length) {
          chatLines.push({ kind: kind, text: text });
          cur = null; li++;
          typeTimer = setTimeout(step, 260);
        } else {
          typeTimer = setTimeout(step, 12);
        }
        return;
      }
      chatLines.push({ kind: kind, text: text });
      li++;
      // tui scene: switch to compact chrome after the /tui style command.
      if (name === "tui" && kind === "cmd" && /\/tui style compact/.test(text)) compact = true;
      render();
      typeTimer = setTimeout(step, 260);
    }
    render();
    step();
  }

  function initScenes() {
    bodyEl = document.getElementById("demo-body");
    titleEl = document.getElementById("demo-title");
    if (!bodyEl || typeof SwarmSimulator !== "function") return;
    sectionEls = Array.from(document.querySelectorAll(".split-section[data-scene]"));
    currentScene = "swarm";
    bodyEl.innerHTML = CUE_HTML;
  }
  // ── Version galaxy (milky‑way cluster) ──

  function initVersionGalaxy() {
    var heads = document.querySelectorAll('h2');
    var entries = [];
    for (var i = 0; i < heads.length; i++) {
      if (/New in|Previously|Earlier/.test(heads[i].textContent)) {
        var grid = heads[i].nextElementSibling;
        if (grid && grid.classList.contains('roadmap-grid')) {
          entries.push({ h2: heads[i], grid: grid });
        }
      }
    }
    if (!entries.length) return;

    var verse = document.createElement('div');
    verse.className = 'v-verse';
    var labels = [];
    for (var j = 0; j < entries.length; j++) {
      var h2 = entries[j].h2;
      var en = h2.querySelector('[data-l="en"]');
      labels.push(en ? en.textContent.replace(/New in |Previously — |Earlier — /g, '') : h2.textContent);
      h2.style.display = 'none';
      entries[j].grid.style.display = 'none';
    }

    var refNode = entries[0].h2;
    refNode.parentNode.insertBefore(verse, refNode);

    verse.innerHTML = '<h2 class="v-title"><span data-l="en">Explore Releases</span><span data-l="zh">探索版本</span></h2><div class="v-web-wrap"><div class="v-stars"></div></div><svg class="v-tl-beam" viewBox="0 0 600 80" preserveAspectRatio="xMidYMin meet"><path class="v-tl-beam-path"/></svg><div class="v-timeline"><div class="v-tl-dots"></div></div><div class="v-stage" aria-live="polite"></div>';

    var starContainer = verse.querySelector('.v-stars');
    var beamPath = verse.querySelector('.v-tl-beam-path');
    var dotsContainer = verse.querySelector('.v-tl-dots');
    var stage = verse.querySelector('.v-stage');

    var W = 600, H = 320, cx = W/2, cy = H/2;
    var stars = [];
    var timelineDots = [];
    var total = entries.length;

    for (var k = 0; k < total; k++) {
      var t = (k + 0.5) / total;
      var angle = t * Math.PI * 4 + 0.8;
      var r = Math.pow(t, 0.55) * 140;
      // Deterministic golden-ratio offset — consistent across page loads
      var phi = (k * 1.618034) % 1;
      var rx = r + (phi - 0.5) * r * 0.15;
      var ry = rx * 0.5;
      var aOff = (phi - 0.5) * 0.25;
      var x = cx + Math.cos(angle + aOff) * rx;
      var y = cy + Math.sin(angle + aOff) * ry;

      var wrapper = document.createElement('div');
      wrapper.className = 'v-star-wrapper';
      var size = 34 + (1 - t) * 24;
      // Percentage positions scale with the container — no clipping on
      // narrow screens (x/y live in the fixed 600×320 design space).
      wrapper.style.cssText = 'left:' + (x / W * 100).toFixed(2) + '%;top:' + (y / H * 100).toFixed(2) + '%;';

      var star = document.createElement('button');
      star.type = 'button';
      star.className = 'v-star';
      star.style.cssText = 'width:' + size + 'px;height:' + size + 'px;';
      star.innerHTML = '<span class="v-label">' + labels[k] + '</span>';
      star.dataset.idx = k;
      star.setAttribute('aria-label', (currentLang() === 'zh' ? '查看版本 ' : 'Show version ') + labels[k]);
      star.setAttribute('aria-pressed', 'false');
      wrapper.appendChild(star);
      starContainer.appendChild(wrapper);
      stars.push({ el: star, wrapper: wrapper, x: x, y: y, idx: k });

      star.addEventListener('click', (function(idx) {
        return function() { showGalaxyVersion(idx, entries, stage, stars, beamPath, timelineDots); };
      })(k));

      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'v-tl-dot';
      dot.dataset.idx = k;
      dot.setAttribute('aria-label', (currentLang() === 'zh' ? '查看版本 ' : 'Show version ') + labels[k]);
      dot.setAttribute('aria-pressed', 'false');
      dot.innerHTML = '<svg class="v-tl-rib" viewBox="0 0 2 40" aria-hidden="true"><line x1="1" y1="40" x2="1" y2="40"/></svg><span class="v-tl-ring"></span><span class="v-tl-label">' + labels[k] + '</span>';
      dot.addEventListener('click', (function(idx) {
        return function() { showGalaxyVersion(idx, entries, stage, stars, beamPath, timelineDots); };
      })(k));
      dotsContainer.appendChild(dot);
      timelineDots.push(dot);
    }

    showGalaxyVersion(0, entries, stage, stars, beamPath, timelineDots);
  }

  var _activeGalaxy = null;
  var _activeTlIdx = -1;
  function showGalaxyVersion(idx, entries, stage, stars, beamPath, timelineDots) {
    if (_activeGalaxy) {
      _activeGalaxy.classList.remove('active');
      _activeGalaxy.setAttribute('aria-pressed', 'false');
    }
    _activeGalaxy = stars[idx].el;
    _activeGalaxy.classList.add('active');
    _activeGalaxy.setAttribute('aria-pressed', 'true');

    if (_activeTlIdx >= 0) {
      timelineDots[_activeTlIdx].classList.remove('active');
      timelineDots[_activeTlIdx].setAttribute('aria-pressed', 'false');
    }
    _activeTlIdx = idx;
    timelineDots[idx].classList.add('active');
    timelineDots[idx].setAttribute('aria-pressed', 'true');

    // Rib line grows upward
    var allRibs = document.querySelectorAll('.v-tl-rib line');
    for (var ri = 0; ri < allRibs.length; ri++) {
      allRibs[ri].setAttribute('y2', ri === idx ? '0' : '40');
    }

    stage.innerHTML = '';
    var grid = entries[idx].grid;
    grid.style.display = '';
    grid.classList.remove('v-reveal');
    void grid.offsetWidth;
    grid.classList.add('v-reveal');
    stage.appendChild(grid);

    var hadReady = beamPath.classList.contains('v-tl-ready');
    beamPath.classList.remove('v-tl-ready');
    if (hadReady) {
      setTimeout(function() {
        updateBeam(idx, stars, beamPath, timelineDots);
      }, 350);
    } else {
      updateBeam(idx, stars, beamPath, timelineDots);
    }
  }

  function updateBeam(idx, stars, beamPath, timelineDots) {
    var beam = beamPath.closest('svg');
    if (!beam || beam.clientWidth === 0) return;
    var dot = timelineDots[idx];
    if (!dot) return;

    var scale = 600 / beam.clientWidth;
    var sx = stars[idx].x;
    var dotRect = dot.getBoundingClientRect();
    var beamRect = beam.getBoundingClientRect();
    var dx = (dotRect.left + dotRect.width / 2 - beamRect.left) * scale;

    beamPath.setAttribute('d', 'M ' + sx + ',0 C ' + sx + ',40 ' + dx + ',40 ' + dx + ',80');
    beamPath.classList.add('v-tl-ready');
  }

  document.addEventListener('DOMContentLoaded', initVersionGalaxy);
})();
