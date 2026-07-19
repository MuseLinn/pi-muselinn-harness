---
layout: default
title: pi-muselinn-harness
---

<div class="hero" markdown="1">

# pi-muselinn-harness

**The features Pi deliberately skips — built, integrated, and Kimi Code-aligned.**

> "Pi ships with powerful defaults but skips features like sub-agents and plan mode."
> — [pi.dev](https://pi.dev). This harness builds exactly those, as one coherent package.

[![npm version](https://img.shields.io/npm/v/pi-muselinn-harness?color=5bc0be)](https://www.npmjs.com/package/pi-muselinn-harness)
[![license](https://img.shields.io/npm/l/pi-muselinn-harness?color=4fa8ff)](https://github.com/MuseLinn/pi-muselinn-harness/blob/main/LICENSE)
[![tests](https://img.shields.io/badge/tests-269%20assertions-5bc0be)](https://github.com/MuseLinn/pi-muselinn-harness#tests)

```bash
pi install npm:pi-muselinn-harness
```

</div>

<div class="card-grid">
<div class="card" markdown="1">
### ⬒ Swarm
Concurrent subagents with a live braille-grid TUI. Real `max_concurrency` worker pool, 30-min timeouts, two-step `/cancel`, `/resume`, three-pane task browser (`ctrl+shift+t`).
</div>
<div class="card" markdown="1">
### ◎ Goal
`/goal` lifecycle with budgets (turns / tokens / wall-clock), 3-turn blocked circuit breaker, completion-criterion gate, FIFO queue, session persistence.
</div>
<div class="card" markdown="1">
### ✎ Plan
Plan mode with read-only tool restrictions and plan-file guard. The LLM explores and writes a plan; execution waits for your approval.
</div>
<div class="card" markdown="1">
### ⛨ Permission
18-level policy chain across `auto` / `yolo` / `manual`. Destructive commands always ask; `.env` / `id_rsa` never pass — even in auto mode.
</div>
<div class="card" markdown="1">
### ⏱ Task
Background subagents with early task-ID return, paged output, 50-task cap, 7-day stale cleanup — plus 5-field cron with jitter and one-shots.
</div>
<div class="card" markdown="1">
### ⚡ Hooks
Kimi Code-aligned `[[hooks]]` engine. 16 events, blockable `PreToolUse` / `Stop` / `UserPromptSubmit`, exit-code semantics, fail-open.
</div>
<div class="card" markdown="1">
### ✦ Skills
Seven-scope scanner — pi-native dirs first, Kimi Code dirs as compat. Collision-free discovery, available in main session and subagents alike.
</div>
<div class="card" markdown="1">
### ▭ TUI
Kimi-style closed-box editor (`╭─╮ │ ╰─╯`) with spinner + working state in the top border, plan-mode badge, `/tui` hot style switching, timing probe.
</div>
</div>

## See the editor

```
╭ ⠋ Streaming ─ plan ───────────────────────────────╮
│                                                      │
╰──────────────────────────────────────────────────────╯
```

The default **boxed** style draws a closed box around pi's input, embeds a braille
spinner with the live working state (`Thinking` / `Streaming` / `Running tools`),
and shows a `plan` badge while plan mode is active. Switch anytime:

```
/tui style plain|boxed|compact
```

## Why one harness instead of eight extensions?

One extension, one config surface, zero cross-extension conflicts — the modules
share state by design: the goal badge lives in the swarm widget, the plan-mode
badge sits on the editor border, the permission mode shows in the status bar.
And **269 pure-node assertions** regression-test every module without burning
model quota.

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
