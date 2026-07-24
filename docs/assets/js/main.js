/* pi-style-web: theme toggle + lang toggle + scroll reveal + demo scenes */
(function () {
  var root = document.documentElement;

  // ── Theme toggle ──
  function currentTheme() {
    return root.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  function applyToggle(btn) {
    btn.textContent = currentTheme() === "light" ? "☾" : "☀";
    btn.setAttribute("aria-label", "toggle color theme");
  }

  // ── Language toggle (EN/中) ──
  function currentLang() {
    return root.getAttribute("data-lang") === "zh" ? "zh" : "en";
  }
  function setLang(lang) {
    root.setAttribute("data-lang", lang);
    try { localStorage.setItem("lang", lang); } catch (e) { /* ok */ }
    var btn = document.getElementById("lang-toggle");
    if (btn) btn.textContent = lang === "zh" ? "EN" : "中";
  }

  document.addEventListener("DOMContentLoaded", function () {
    // theme
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      applyToggle(btn);
      btn.addEventListener("click", function () {
        var next = currentTheme() === "light" ? "dark" : "light";
        root.setAttribute("data-theme", next);
        try { localStorage.setItem("theme", next); } catch (e) { /* ok */ }
        applyToggle(btn);
      });
    }

    // lang
    var langBtn = document.getElementById("lang-toggle");
    if (langBtn) {
      langBtn.textContent = currentLang() === "zh" ? "EN" : "中";
      langBtn.addEventListener("click", function () {
        setLang(currentLang() === "zh" ? "en" : "zh");
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
    '<span class="scroll-cue"><span class="prompt">$</span>scroll to continue' +
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
      lines: [
        ["cmd", "$ /goal Ship v0.8 with all 269 tests green"],
        ["ok",  "● Goal: active · turns 0 · no budget"],
        ["dim", "  context injected: <untrusted_objective>"],
        ["dim", "  working through the queue..."],
        ["ok",  "✓ criterion verified: tests 269/269 green"],
        ["ok",  "● Goal: complete · 14 turns · 6m12s"],
        ["cmd", "$ /goal budget 50 turns"],
        ["dim", "  budget set: turnBudget=50 (next goal)"],
      ],
    },
    plan: {
      title: "plan · read-only first",
      lines: [
        ["cmd", "$ /plan Refactor the renderer into modules"],
        ["dim", "● plan mode: write tools restricted to plan file"],
        ["dim", "  exploring: tui/box.ts, tui/editor.ts, swarm/widget.ts"],
        ["ok",  "  plan written → .pi/plans/PLAN.md"],
        ["cmd", "$ exit_plan_mode (approve)"],
        ["ok",  "✓ plan approved — execution unlocked"],
        ["dim", "  editor top border shows: ╭ plan ───────╮"],
      ],
    },
    permission: {
      title: "permission · 18-level chain",
      lines: [
        ["cmd", "$ git push --force origin main"],
        ["warn","⚠ destructive command detected — approval required"],
        ["dim", "  policy: destructive-ask-always (never short-circuited)"],
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
      lines: [
        ["box", "⠋ Streaming · plan"],
        ["box", "tell me about the swarm module"],
        ["cmd", "$ /tui style compact"],
        ["dim", "─ ⣾ Running tools ──────────── deepseek-v4 ─"],
        ["cmd", "$ /tui timing"],
        ["dim", "editor: n=240 mean=0.31ms p50=0.28ms p99=1.2ms"],
      ],
    },
  };

  var TYPE_COLORS = {
    dark: {
      cmd: "#7aa2f7", ok: "#4ec87e", dim: "#7d8aa3",
      warn: "#e8a838", err: "#e85454", box: "#5bc0be",
    },
    light: {
      cmd: "#3b6fd4", ok: "#1e9e57", dim: "#6b7688",
      warn: "#b57d1f", err: "#d33f3f", box: "#1f8a87",
    },
  };

  function typeColor(kind) {
    var set = root.getAttribute("data-theme") === "light" ? TYPE_COLORS.light : TYPE_COLORS.dark;
    return set[kind] || "#c4cede";
  }

  function startTypeScene(name) {
    var scene = TYPE_SCENES[name];
    if (!scene) return;
    setTitle(scene.title);
    bodyEl.innerHTML = "";
    var pre = document.createElement("pre");
    pre.className = "demo-pre";
    bodyEl.appendChild(pre);
    var li = 0, ci = 0, cur = null, curBox = null;
    function step() {
      if (li >= scene.lines.length) {
        typeTimer = setTimeout(function () {
          if (runningScene === name) startTypeScene(name);
        }, 7000);
        return;
      }
      var kind = scene.lines[li][0];
      var text = scene.lines[li][1];
      if (kind === "box") {
        // Box lines appear instantly (no typewriter); consecutive boxes accumulate
        // into one .demo-box div.
        if (!curBox) {
          curBox = document.createElement("div");
          curBox.className = "demo-box";
          pre.appendChild(curBox);
        }
        curBox.textContent = (curBox.textContent ? curBox.textContent + "\n" : "") + text;
        var nextKind = scene.lines[li + 1] && scene.lines[li + 1][0];
        if (nextKind !== "box") { curBox = null; }
        li++;
        pre.appendChild(document.createTextNode(nextKind === "box" ? "" : "\n"));
        typeTimer = setTimeout(step, 260);
      } else {
        if (!cur) {
          cur = document.createElement("span");
          cur.style.color = typeColor(kind);
          pre.appendChild(cur);
          ci = 0;
        }
        cur.textContent = text.slice(0, ++ci);
        if (ci >= text.length) {
          pre.appendChild(document.createTextNode("\n"));
          cur = null; li++;
          typeTimer = setTimeout(step, 260);
        } else {
          typeTimer = setTimeout(step, 12);
        }
      }
    }
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
})();
