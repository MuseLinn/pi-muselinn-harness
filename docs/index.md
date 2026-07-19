---
layout: default
title: pi-muselinn-harness
---

<div class="hero">
  <h1>Pi skips sub-agents and plan mode.<br><em>This harness builds them.</em></h1>
  <p class="sub">Kimi Code-style agent orchestration for the <a href="https://pi.dev">Pi coding agent</a> —<br>
  swarm, goal, plan, permission, task, hooks, skills, and a boxed-editor TUI, in one coherent package.</p>
  <p class="badges">
    <a href="https://www.npmjs.com/package/pi-muselinn-harness"><img src="assets/img/badge-npm.svg" alt="npm version"></a>
    <a href="https://github.com/MuseLinn/pi-muselinn-harness/blob/main/LICENSE"><img src="assets/img/badge-license.svg" alt="license: MIT"></a>
    <a href="https://github.com/MuseLinn/pi-muselinn-harness#tests"><img src="assets/img/badge-tests.svg" alt="tests: 269 assertions"></a>
  </p>
  <div class="installbar">
    <span><span class="prompt">$</span>pi install npm:pi-muselinn-harness</span>
    <span class="hint">npm</span>
  </div>
</div>

<div class="termframe">
  <div class="termtitle">boxed editor · live</div>
  <img src="assets/img/pi-boxed-editor.png" alt="Closed-box editor with the working state embedded in the top border">
</div>

<div class="card-grid">
<div class="card" markdown="1">
### ⬒ swarm
Concurrent subagents with a live braille-grid TUI. Real `max_concurrency` worker pool, 30-min timeouts, two-step `/cancel`, `/resume`, three-pane task browser (`ctrl+shift+t`).
</div>
<div class="card" markdown="1">
### ◎ goal
`/goal` lifecycle with budgets (turns / tokens / wall-clock), 3-turn blocked circuit breaker, completion-criterion gate, FIFO queue, session persistence.
</div>
<div class="card" markdown="1">
### ✎ plan
Plan mode with read-only tool restrictions and plan-file guard. The LLM explores and writes a plan; execution waits for your approval.
</div>
<div class="card" markdown="1">
### ⛨ permission
18-level policy chain across `auto` / `yolo` / `manual`. Destructive commands always ask; `.env` / `id_rsa` never pass — even in auto mode.
</div>
<div class="card" markdown="1">
### ⏱ task
Background subagents with early task-ID return, paged output, 50-task cap, 7-day stale cleanup — plus 5-field cron with jitter and one-shots.
</div>
<div class="card" markdown="1">
### ⚡ hooks
Kimi Code-aligned `[[hooks]]` engine. 16 events, blockable `PreToolUse` / `Stop` / `UserPromptSubmit`, exit-code semantics, fail-open.
</div>
<div class="card" markdown="1">
### ✦ skills
Seven-scope scanner — pi-native dirs first, Kimi Code dirs as compat. Collision-free discovery, available in main session and subagents alike.
</div>
<div class="card" markdown="1">
### ▭ tui
Kimi-style closed-box editor (`╭─╮ │ ╰─╯`) with spinner + working state in the top border, plan-mode badge, `/tui` hot style switching, timing probe.
</div>
</div>

## Why one harness instead of eight extensions?

One extension, one config surface, zero cross-extension conflicts — the modules
share state by design: the goal badge lives in the swarm widget, the plan-mode
badge sits on the editor border, the permission mode shows in the status bar.
And **269 pure-node assertions** regression-test every module without burning
model quota. No companion extensions required — it is fully functional standalone
(optional: `rpiv-ask-user-question` for interactive model picking, `rpiv-todo`
for a live todo overlay). Plays well with others: the screenshot above runs
alongside 19 other extensions.

## Commands

```
/swarm on|off        /cancel      /resume       /tasks (ctrl+shift+t)
/goal <objective>    /goal pause|resume|cancel|replace|budget|queue
/plan [on|off|clear] /mode        /tui style plain|boxed|compact
```

All commands support Tab completion for subcommands and arguments.

## Experimental

[`feature/math-renderer`](https://github.com/MuseLinn/pi-muselinn-harness/tree/feature/math-renderer) —
renders `$$...$$` display math in assistant messages via [txm](https://github.com/thatmagicalcat/txm)
(cell-based 2D typesetting, works in Windows Terminal). Context-safe: the original
Markdown is restored before every LLM call.

## Links

- [GitHub](https://github.com/MuseLinn/pi-muselinn-harness) · [npm](https://www.npmjs.com/package/pi-muselinn-harness) · [pi.dev catalog](https://pi.dev/packages)
- [English README](https://github.com/MuseLinn/pi-muselinn-harness/blob/main/README.md) · [中文文档](https://github.com/MuseLinn/pi-muselinn-harness/blob/main/README.zh-CN.md)
- License: MIT
