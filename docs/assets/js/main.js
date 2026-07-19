/* pi-style-web: theme toggle + scroll reveal */
(function () {
  var root = document.documentElement;

  function currentTheme() {
    return root.getAttribute("data-theme") === "light" ? "light" : "dark";
  }

  function applyToggle(btn) {
    btn.textContent = currentTheme() === "light" ? "\u263E" : "\u2600";
    btn.setAttribute("aria-label", "toggle color theme");
    btn.setAttribute("title", "toggle color theme");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      applyToggle(btn);
      btn.addEventListener("click", function () {
        var next = currentTheme() === "light" ? "dark" : "light";
        root.setAttribute("data-theme", next);
        try { localStorage.setItem("theme", next); } catch (e) { /* private mode */ }
        applyToggle(btn);
      });
    }

    // Scroll reveal — respects prefers-reduced-motion.
    var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var els = document.querySelectorAll(".reveal");
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -24px 0px" });
    els.forEach(function (el) { io.observe(el); });
  });
})();
