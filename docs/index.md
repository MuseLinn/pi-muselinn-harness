# pi-muselinn-harness

**Kimi Code-style agent orchestration harness for the [Pi coding agent](https://pi.dev)** — seven integrated modules that turn pi into a full agentic workbench: concurrent subagents, goal lifecycle, plan mode, a fine-grained permission chain, background tasks + cron, a hooks engine, a seven-scope skills scanner, and a Kimi-style boxed editor.

> 中文说明见 [README.md](https://github.com/MuseLinn/pi-muselinn-harness#readme)。A Kimi Code 风格的 pi 扩展:并行子代理、目标系统、计划模式、权限链、后台任务、Hooks 引擎、技能扫描与闭合框编辑器。

## Install

```bash
pi install npm:pi-muselinn-harness
```

Or from source:

```bash
pi install git:github.com/MuseLinn/pi-muselinn-harness
```

## Modules

| Module | What you get |
|--------|--------------|
| **Swarm** | Concurrent subagents (`agent_swarm` / `agent` tools) with a braille-grid live TUI, worker pool, 30-min timeouts, two-step `/cancel`, `/resume` |
| **Goal** | `/goal` lifecycle — budgets (turns/tokens/wall-clock), blocked-after-3-turns circuit breaker, FIFO queue, session persistence |
| **Plan** | Plan mode with read-only tool restrictions, plan file per session, context injection |
| **Permission** | 18-level policy chain (`auto` / `yolo` / `manual`) with AGENTS.md hierarchy and destructive-command guards |
| **Task** | Background tasks (`run_background`, `task_list/output/stop`) + 5-field cron with jitter and one-shots |
| **Hooks** | Kimi Code-aligned `[[hooks]]` engine — 16 events, blockable `PreToolUse` / `Stop` / `UserPromptSubmit`, fail-open |
| **Skills** | Seven-scope scanner (pi-native dirs first, Kimi Code dirs as compat), collision-free `resources_discover` |
| **TUI** | Kimi-style boxed editor (`╭─╮ │ ╰─╯`) with spinner + working state in the top border, plan-mode badge, `/tui` style switching, render timing probe |

## Commands

```
/swarm on|off        /cancel      /resume       /tasks (ctrl+shift+t)
/goal <objective>    /goal pause|resume|cancel|replace|budget|queue
/plan [on|off|clear] /mode        /tui style plain|boxed|compact
```

All commands support Tab completion for subcommands and arguments.

## Why harness instead of separate extensions?

One extension, one config surface, zero cross-extension conflicts: the modules share state (goal badge in the swarm widget, plan-mode badge in the editor border, permission mode in the status bar) because they were designed together. 269 pure-node unit assertions keep every module regression-tested without model quota.

## Experimental

- [`feature/math-renderer`](https://github.com/MuseLinn/pi-muselinn-harness/tree/feature/math-renderer) — renders `$$...$$` display math in assistant messages via [txm](https://github.com/thatmagicalcat/txm) (cell-based 2D typesetting, works in Windows Terminal). Context-safe: original Markdown is restored before every LLM call.

## Links

- [GitHub repository](https://github.com/MuseLinn/pi-muselinn-harness)
- [npm package](https://www.npmjs.com/package/pi-muselinn-harness)
- [pi.dev package catalog](https://pi.dev/packages)
- License: MIT
