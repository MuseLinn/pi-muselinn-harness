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
  var bodyEl, titleEl, active = null;
  var swarm = null, swarmRestart = null, typeTimer = null;

  // Scroll-progress driven terminal (pi.dev architecture): a single
  // progress var --p (0 at top -> 1 after 0.7 viewport of scroll) and a
  // sections-reveal var --sp are written to the shell; every geometric
  // change is CSS calc() interpolation. --dx is the horizontal shift
  // that centers the terminal in the viewport at p=0.
  function initScrollProgress() {
    var shell = document.getElementById("split");
    var term = document.getElementById("demo-term");
    var sections = document.querySelector(".split-sections");
    if (!shell || !term) return;

    var wide = window.matchMedia("(min-width: 761px)");
    var pending = false;

    function updateGeometry() {
      if (!wide.matches) { shell.style.setProperty("--dx", "0px"); return; }
      // Parent (.split-term) is sticky and untransformed — its rect is
      // the docked position; shift from there to viewport center.
      var pr = term.parentElement.getBoundingClientRect();
      var cx = pr.left + pr.width / 2;
      shell.style.setProperty("--dx", Math.round(window.innerWidth / 2 - cx) + "px");
    }

    function updateProgress() {
      var p = Math.min(1, Math.max(0, window.scrollY / (window.innerHeight * 0.7)));
      var sp = Math.min(1, Math.max(0, (p - 0.75) / 0.25));
      if (!wide.matches) { p = 1; sp = 1; }
      shell.style.setProperty("--p", p.toFixed(4));
      shell.style.setProperty("--sp", sp.toFixed(4));
      if (sections) sections.classList.toggle("is-visible", sp > 0.001);
    }

    function onScroll() {
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

  function stopScene() {
    if (swarm) { swarm.stop(); swarm = null; }
    if (swarmRestart) { clearTimeout(swarmRestart); swarmRestart = null; }
    if (typeTimer) { clearTimeout(typeTimer); typeTimer = null; }
  }

  function setTitle(t) { if (titleEl) titleEl.textContent = t; }

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
        ["box", "╭ ⠋ Streaming ─ plan ─────────────────────────╮"],
        ["box", "│  tell me about the swarm module               │"],
        ["box", "╰──────────────────────────────────────────────╯"],
        ["cmd", "$ /tui style compact"],
        ["dim", "─ ⣾ Running tools ──────────── deepseek-v4 ─"],
        ["cmd", "$ /tui timing"],
        ["dim", "editor: n=240 mean=0.31ms p50=0.28ms p99=1.2ms"],
      ],
    },
  };

  var TYPE_COLORS = {
    cmd: "#7aa2f7", ok: "#4ec87e", dim: "#7d8aa3",
    warn: "#e8a838", err: "#e85454", box: "#5bc0be",
  };

  function startTypeScene(name) {
    var scene = TYPE_SCENES[name];
    if (!scene) return;
    setTitle(scene.title);
    bodyEl.innerHTML = "";
    var pre = document.createElement("pre");
    pre.className = "demo-pre";
    bodyEl.appendChild(pre);
    var li = 0, ci = 0, cur = null;
    function step() {
      if (li >= scene.lines.length) {
        typeTimer = setTimeout(function () { startTypeScene(name); }, 7000); // loop
        return;
      }
      if (!cur) {
        cur = document.createElement("span");
        cur.style.color = TYPE_COLORS[scene.lines[li][0]] || "#c4cede";
        pre.appendChild(cur);
        ci = 0;
      }
      var text = scene.lines[li][1];
      cur.textContent = text.slice(0, ++ci);
      if (ci >= text.length) {
        pre.appendChild(document.createTextNode("\n"));
        cur = null; li++;
        typeTimer = setTimeout(step, 260);
      } else {
        typeTimer = setTimeout(step, 12);
      }
    }
    step();
  }

  function setScene(name) {
    if (active === name || !bodyEl) return;
    active = name;
    // Crossfade between scenes (pi.dev-style) instead of a hard swap.
    bodyEl.classList.add("fading");
    setTimeout(function () {
      stopScene();
      bodyEl.innerHTML = "";
      bodyEl.classList.remove("fading");
      if (name === "swarm") startSwarmScene();
      else startTypeScene(name);
    }, 170);
  }

  function initScenes() {
    bodyEl = document.getElementById("demo-body");
    titleEl = document.getElementById("demo-title");
    if (!bodyEl || typeof SwarmSimulator !== "function") return;

    var sections = document.querySelectorAll(".split-section[data-scene]");
    if ("IntersectionObserver" in window && sections.length) {
      // Center-band driving: the section crossing the middle 10% of the
      // viewport owns the scene — deterministic, no lead/lag vs prose.
      var so = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) setScene(entry.target.getAttribute("data-scene"));
        });
      }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });
      sections.forEach(function (s) { so.observe(s); });
    }
    setScene("swarm"); // initial
  }
})();
