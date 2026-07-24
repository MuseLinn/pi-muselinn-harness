# pi-muselinn-harness

[![test](https://github.com/MuseLinn/pi-muselinn-harness/actions/workflows/test.yml/badge.svg)](https://github.com/MuseLinn/pi-muselinn-harness/actions/workflows/test.yml)

**Kimi Code-style agent orchestration harness for the [Pi coding agent](https://pi.dev)** — Swarm · Goal · Plan · Permission · Ask · Task · Cron · Todo · Hooks · Skills · TUI, an eleven-module architecture that builds the features Pi deliberately skips (sub-agents, plan mode, todo, …) and aligns them with Kimi Code's subsystem behavior.

> **Development focus:** main-line development happens in **MusePi** (the Pi fork) — see [MusePi-PLAN.md](https://github.com/MuseLinn/pi-muselinn-harness/blob/main/MusePi-PLAN.md). This extension stays maintained: bug fixes, Pi compatibility updates, and new features that fit the extension form. Compatible with pi 0.81.x–0.82.x on macOS, ubuntu, and windows; Node 22/24, CI-tested on ubuntu + windows.

### What's new in 0.9.9

**Final polish before release:**
- **No keyboard shortcut for toggle** — `alt+t`/`opt+t` removed (Windows SSH misinterprets bare `t` as `alt+t`); use `/todo toggle` instead
- **Widget default collapsed view** — phase-structured tree with roman numerals, shows only incomplete tasks; `alt+t` → `/todo toggle`
- **Pages mobile & box-style fix** — terminal box uses dynamic CSS `border` instead of hardcoded Unicode box-drawing characters; mobile layout: sticky terminal with scene switching, `aspect-ratio: 4/3` adapted for small screens
- **Schema fix** — `notes` field properly nested under `parameters.properties` (was inside `items`), `add_notes` now works
- **Build fix** — stray `}` at line 335 removed, extension loads cleanly
- All 12 test suites green
### What's new in 0.9.3–0.9.8

**Integration & consistency fixes:**
- Widget API fixed: `ctx.widget()` → `ctx.ui.setWidget("todo", content)`, empty list clears widget instead of showing "(empty)" clutter
- `/todo` subcommands aligned with oh-my-pi: `view` → `export`, added `copy`, `edit`, bare `/todo` prints Markdown
- Every `/todo` subcommand produces status feedback via `ctx.showStatus`
- Removed redundant `/todo help` / `?` (command registry provides discoverability)
- `clearTodoSession` now wired to `session_end` event (was imported but never called)
- `require()` → ES `import` for `swarmState` (require silently failed in bundled ESM runtime — subagent matching finally works)
- All 12 test suites green at every commit

### What's new in 0.9.1

**Bug fixes:**
- Fixed `add_notes` case in `applyEntry` — no longer falls through into `update_details` (all add_notes calls rejected with "Missing details value")
- Fixed stray `completed: number` in function body that blocked module parsing
- `todoMatchesAnyDescription` now correctly checks shorter string against longer one for substring matching
- All 94 TODO tests green, full suite 12/12

### What's new in 0.9.0

**TODO Phase Model — phased task planning with reminders built in.**

The todo system is rewritten with an oh-my-pi-style phase model (`TodoPhase`):
per-task status (`pending`/`in_progress`/`completed`/`abandoned`), 7 ops
(`init`/`start`/`done`/`drop`/`rm`/`append`/`view`), and auto-promote of the
first task on phase init. The widget renders a roman-numeral phase tree
(`Ⅰ. Scanner · 2/4`) with collapse/expand.

**Reminder system:** When the agent stops with incomplete todos, a
`<system-reminder>` injects the task list into the next turn (max 3
reminders, debounced).

**Markdown round-trip:** `/todo export/import` serializes and restores phases
as Markdown for sharing and persistence between sessions.

**Plan Mode — Kimi Code permission model alignment.**

Plan mode no longer maintains its own bash command whitelist. Instead, bash
follows the normal permission mode (auto/yolo/manual) — the same design as
Kimi Code. Only the following are blocked during planning:
- **Write/Edit** to files outside the active plan file
- **TaskStop** (would abort background work during planning)
- **CronCreate / CronDelete** (would mutate scheduled work)

The plan file path is matched by exact path, `local://` scheme basename, and
resolved absolute path under the session's `plans/` directory — all three paths
accepted.

This eliminates the root cause of "stuck in plan mode" where common commands
like `cd` were blocked by the bash whitelist, and plan file writes using the
`local://` scheme were rejected.

**Plan mode bash permission model:**

| Before (0.8.2) | After (0.9.0) |
|---|---|
| Static regex whitelist (~35 commands) | No bash restriction — follows permission mode |
| `cd` not in whitelist → blocked | `cd`, `git push`, `npm install` all allowed (permission mode decides) |
| `local://` plan writes rejected (path mismatch) | `local://` basename matched against active plan file |
| Deny-by-default for unmatched commands | Allow-by-default, permission chain controls |

### What's new in 0.8.2

**Custom Agent Files** — Define agent profiles as Markdown files with YAML frontmatter:
```markdown
---
name: my-coder
description: Custom coding agent with restricted tools
tools:
  - Read
  - Grep
  - Edit
  - Bash
disallowedTools:
  - Bash
---
You are a specialized coding agent.
${base_prompt}
```
Place them in `.pi/agents/`, `.kimi-code/agents/`, or `.agents/agents/` (project or user scope).
Use `agent_file_list` to browse, and pass `agent_file="my-coder"` to `agent` or `agent_swarm`.

**Tool Gating** — Three-layer tool policy integrated into the permission chain.
Agent profiles can restrict which tools a subagent may use; the policy is enforced
at the `tool_call` event level, before the 18-level permission chain.

**Agent Lifecycle Events** — `agent.created` / `agent.disposed` events tracked
per subagent. Active agent count shown in the status bar (`[3 agents running]`).

**Permission Mode Rework (kimi-code aligned):**
- **Auto** — truly automatic: no dialogs for any tool (including destructive/sensitive).
  `AskUserQuestion` is disabled. `ExitPlanMode` auto-approves with a warning.
- **YOLO** — fast but still safe: destructive commands, `.env` access, `.git` paths
  still require approval. `AskUserQuestion` is allowed. `ExitPlanMode` shows review.
- **Manual** — full 18-level policy chain with fallback-ask.

**Plan Mode improvements:**
- `task_stop` / `cron_create` / `cron_delete` blocked during planning
- Sparse/full injection reminders (less prompt bloat on long planning sessions)
- Auto-mode ExitPlanMode warns "user has NOT explicitly approved"

### What's new in 0.7.8

- **Task module reliability fixes** — the two root causes behind broken background tasks on pi ≥ 0.81:
  - `run_background` died at spawn (`task_output` empty, `block:true` returned instantly): the subagent resource loader omitted `LoadExtensionsResult.runtime`, which pi 0.81's `ExtensionRunner.bindCore` requires — `createAgentSession` threw and every background task failed immediately. The loader now includes the runtime when the SDK provides it (still 0.80-compatible)
  - `task_list` crashed with no arguments while `active_only:true` worked: restored persisted entries carry the task text as `description` (or not at all), and the list formatter called `prompt.slice()` on `undefined`. Restore now maps `description` → `prompt` and defaults missing prompts; `task_output` also surfaces `[task failed: <error>]` for tasks that died before producing output
- **Plan persistence dedup** — `PlanManager.persist()` skips appends identical to the last persisted state (observed: 5 identical `muselinn_plan` entries within 25 s), and restore seeds the dedup baseline so a no-change persist doesn't re-append
- **Tests** — new `task.test.mjs` suite (16 checks) + plan dedup regression cases; 19 suites / 580 assertions, all green

### What's new in 0.7.7

- **Plan mode fixes** — the bash read-only gate now understands `rtk`-wrapped commands (pi-rtk-optimizer rewrites commands in place) and Windows `dir`; **Revise** keeps the same plan object instead of trapping you or losing work; review timeout raised 60 s → 600 s; a stale persisted plan with no file on disk deactivates cleanly instead of trapping the session; the `plan` badge now also follows tool-driven plan mode
- **Goal fixes** — footer badge counters (`turns` / tokens / wall-clock) restore monotonically, so they never flicker backwards; completed goals leave a tombstone entry and can't be resurrected with stale counters; `update_goal` docs now state the `verified=true` rule explicitly (required to complete a goal with a declared criterion)
- **Ask dialog robustness** — scrolling window for long option lists, answer deduplication, and background-question support, on top of the tabbed multi-question dialog (multi-select + free-text Other)
- **CI/CD** — GitHub Actions test matrix (ubuntu + windows × node 22/24) on every push/PR

### What's new in 0.7.4

- **`ask_user_question` tool** — native interactive question dialog with numbered options, shared with the approval flow
- **`todo_list` tool + inline panel** — session-shared todo with collapse policy (replaces external rpiv-todo)
- **Approval panel** — per-tool titles, number-key selection, reject-with-reason (manual permission tier)
- **Swarm permission gating** — shared permission manager; `/mode` broadcasts to all subagents
- **Editor anchoring** — input anchored after slash-menu closes (render-edge detection)
- **`toolResultTruncation`** — oversized tool results persisted to disk with preview + `output_path`
- **Subagent resume guard** — ownership/idle validation before resuming
- **`fetch_url` tool** — no-auth URL fetching (replaces external dependency)
- **Plugin manifest** — six-piece package metadata set

[中文文档](README.zh-CN.md) · [Project page](https://muselinn.github.io/pi-muselinn-harness/) · [pi.dev catalog](https://pi.dev/packages)

![Closed-box editor with streaming state in the top border](https://muselinn.github.io/pi-muselinn-harness/assets/img/pi-boxed-editor.png)
## Install
Already installed? Re-run the same command to upgrade to the latest release (0.9.9).
```bash
pi install npm:pi-muselinn-harness
```

Or from git / local source:

```bash
pi install git:github.com/MuseLinn/pi-muselinn-harness
pi install local:~/.pi/agent/extensions/pi-muselinn-harness
```

## Features

### Swarm
- **In-process subagents** — `createAgentSession()` execution, `coder` / `explore` / `plan` types
- **Real concurrency control** — `runProgressive()` worker pool with true `max_concurrency` cap + exponential backoff retries
- **30-minute timeout** — per-subagent `AbortSignal.timeout` (aligned with Kimi Code)
- **run_in_background** — whole swarm goes to a background task, early task-ID return, report written to `output_path`
- **Smart model routing** — task-aware selection from `ctx.modelRegistry`
- **Braille progress bars** — driven by real tool-call progress, 250 ms frames with a state-fingerprint gate (unchanged frames cost nothing)
- **Harness-branded spinner** — single-width braille rotation by default (`PI_MUSELINN_SPINNER=braille|pulse|bounce|moon`, incl. Kimi moon-phase compat)
- **Adaptive layout** — pi-tui Component protocol, status bar width adapts to the terminal (10–60)
- **Three-pane task browser** — status glyphs (○ pending / ◐ running / ✓ done / ✗ failed / ▲ aborted), strikethrough on done rows, overflow collapse (`+N more`, running kept first), named keybindings, `ctrl+shift+t`
- **Cancel / resume** — UserCancellationError + AbortSignal chain, two-step `/cancel`

### Goal
- **Lifecycle** — active / paused / blocked / complete / usage_limited / budget_limited
- **Active Guard** — `create_goal` refuses to silently overwrite an active goal (`replace=true` or `/goal replace`)
- **Blocked 3-turn threshold** — three consecutive blocks for the same reason before really blocking
- **Completion-criterion gate** — a declared criterion must be verified before completing (`verified=true` in the same `update_goal` call; documented in the tool description)
- **Triple budget checks** — tokenBudget + turnBudget + wallClockBudgetMs (`turns/tokens/ms/s/minutes/hours`)
- **Goal Queue** — FIFO + high/normal priority + auto-switch + prioritize/drop/skip
- **Persistence** — appendEntry + session_start restore; counters merge **monotonically** (max per goalId), so a stale entry can never pull turns/tokens backwards; `clear()` writes a tombstone entry so completed goals stay completed
- **Context injection** — `<untrusted_objective>` tag into the system prompt
- **Recovery** — compaction preservation + context-overflow detection + 429 detection

### Plan
- **Plan mode** — the LLM explores, writes a plan, and only executes after approval
- **Kimi Code permission model** — bash is NOT blocked in plan mode; it follows the normal permission mode (auto/yolo/manual). Only Write/Edit (outside plan file), TaskStop, CronCreate, CronDelete are blocked
- **Plan file path matching** — exact path, `local://` scheme basename, and resolved absolute path under `sessionDir/plans/` — all three accepted
- **ExitPlanMode reads the plan file** — presentation matches what was actually written to disk
- **Revise keeps your plan** — a revised or cancelled review re-enters plan mode with the same plan object (id/path/content), never a trap, never lost work; review timeout 600 s
- **Restore validation** — a stale persisted active-plan entry with no content and no file on disk deactivates plan mode instead of trapping the session
- **Context injection** — the plan is injected into the system prompt

### Permission
- **18-level policy chain** — `auto` / `yolo` / `manual`; safety policies (destructive, sensitive files) short-circuit before modes
- **Destructive detection** — `rm -rf` / `git push --force` / `drop table` / `git reset --hard` regex recognition, always asks, never short-circuited by session approvals
- **Sensitive-file guard** — `.env` / `id_rsa` / `*.key` read/write interception, even in auto mode
- **Session approval fingerprints** — approvals remembered per sessionId + input fingerprint, never degrading into "permanent allow"
- **Approval panel** — numbered dialog with per-tool action titles ("Run this command?" / "Apply these edits?"), digit-key direct select, four outcomes: Allow once / Always allow (session) / Deny / Deny with reason (reason relayed to the model)
- **Subagent gating** — swarm worker tool calls run through the same policy chain (shared in-process manager): `/mode` switches propagate to in-flight subagents by construction, `ask` verdicts degrade to blocks (never silent approval)
- **AGENTS.md hierarchy** — project (nearest `AGENTS.md` or `.kimi-code/AGENTS.md`) → global `$KIMI_CODE_HOME/AGENTS.md` → cross-tool `~/.agents/AGENTS.md`, aggregated; `destructive-ask-always` can upgrade ask to deny
- **Config cache** — permission config cached by file mtime, edits take effect immediately

### Task (background + cron)
- **run_background** — subagent in the background, immediate task ID; `output_path` pages full output via Read
- **30-minute timeout** — background tasks auto-fail (`stopReason=timeout_30min`)
- **task_list / task_output / task_stop** — `active_only` filter, `block+timeout` waiting, `offset/limit` paging
- **50-task cap** + **7-day stale cleanup** + orphaned tasks degrade to `process_restart` on restart
- **Incremental persistence** — single-task changes append a single entry; restore stays compatible with old snapshots
- **Cron** — 5-field cron (local timezone) + deterministic jitter (10% of period, ≤15 min) + recurring/one-shot + 50 cap + 7-day stale auto-delete

### Hooks
- **Kimi Code-aligned `[[hooks]]` engine** — reads `$KIMI_CODE_HOME/config.toml` (default `~/.kimi-code/config.toml`) + project `.kimi-code/config.toml`; event/matcher/command/timeout fields
- **Full event coverage** — UserPromptSubmit / PreToolUse / Stop (blockable) + PostToolUse / PostToolUseFailure / PermissionRequest / PermissionResult / SessionStart / SessionEnd / SubagentStart / SubagentStop / StopFailure / Interrupt / PreCompact / PostCompact / Notification
- **Exit-code semantics** — `0` allow (stdout appended as context), `2` block (stderr as reason), anything else / timeout / crash fails open; stdout JSON `permissionDecision: deny` supported
- **Built-in TOML mini-parser** — zero dependencies; invalid rules warn and skip without breaking the extension; mtime-cached hot reload
- **Safety net** — Stop auto-disables after 3 consecutive blocks (anti-loop); every trigger mirrored to `pi.events` for other extensions

### Skills
- **Seven-scope pi-native scanning** — project `.pi/skills`, `.kimi-code/skills` (Kimi compat), `.agents/skills` → user `~/.pi/agent/skills`, `~/.pi/skills`, `$KIMI_CODE_HOME/skills`, `~/.agents/skills`; pi-native dirs win, Kimi dirs as compat layer, dedupe by name
- **Directory + flat forms** — `SKILL.md` subdirs (with auxiliary files) and single `.md` files; full frontmatter fields (name/description/type/whenToUse/disableModelInvocation/arguments, kebab/snake variants)
- **Available to subagents** — swarm and background subagent sessions receive skills via resourceLoader; the main session is injected via `resources_discover` (collision-free: only files from dirs pi does not scan natively, minus names pi already provides)
- **Zero-dependency frontmatter parser** + mtime directory-tree cache

### TUI
- **Closed-box editor** — Kimi Code's `wrapWithSideBorders` ported: pi-tui's horizontal-only borders post-processed into a `╭╮│╰╯` closed box; spinner + working state (Thinking/Streaming/Running tools) embedded in the top border; three styles `plain | boxed | compact` (pi-spark-style info border = compact), default boxed; model name opt-in via `"modelInBorder": true`
- **`/tui` command** — hot-switch styles without restarting (pi preserves text/focus/keybindings when swapping editors); `/tui timing` shows render timing; config persisted to `~/.pi/agent/muselinn-tui.json` (project `.pi/` override)
- **Plan badge** — `plan` text badge on the top border while plan mode is active (no border recoloring — zero conflict with pi's thinking-level colors)
- **Timing probe** — `PI_MUSELINN_HARNESS_TUI_TIMING=1` records editor `render()` P50/P99; spinner only ticks at 250 ms while the agent works

> Note: a pi-spark-style BottomFiller pseudo-fullscreen was implemented, then removed — it only has visual effect when the conversation is shorter than one screen. True editor pinning needs alternate-screen support in pi-core.

### Ask (interactive questions)
- **`ask_user_question` tool** — the agent asks 1-4 structured questions in one tabbed dialog: per-question header tabs (`1/3 · header`, ←/→/Tab to switch), numbered options with description sub-lines, `multi_select` checkboxes (Space toggles, Enter confirms), and an automatic free-text **Other** option on every question; digit keys 1-9 jump straight to an option, arrows/jk navigate, Esc cancels
- **Robust by default** — long option lists scroll inside a bounded window, duplicate answers are deduplicated, and questions can be posed from background tasks without wedging the UI
- **Previews, notes, chat row** — options can carry Markdown **previews** (side-by-side pane on wide terminals, stacked below on narrow ones); attach a per-option **note** with `n`; a **Chat about this** row ends the dialog with a `chat` result so the user can discuss the question instead of answering it
- **Shared dialog component** — the same component backs permission approval (single-select, no Other); in print/RPC mode the tool returns the questions as text instead of blocking
- **Answer reporting** — per-question answers (multi-select as an array); skipped questions and Esc-cancelled dialogs are reported distinctly
- **Auto-mode safe** — auto mode denies `ask_user_question` by policy (no unattended hangs)

- **Inline panel** — above-editor widget with roman-numeral phase tree (`Ⅰ. Scanner · 2/4`), `/todo toggle` expand/collapse, empty list hides widget entirely
- **`/todo` command** — full oh-my-pi phase model: `init`, `start`, `done`, `drop`, `rm`, `append`, `export`, `import`, `copy`, `edit`, `add_notes`, `update_details`, bare `/todo` prints Markdown
- **`todo_list` tool** — model-driven task management with same ops
- **Reminder system** — incomplete todos injected as `<system-reminder>` when agent stops (max 3 reminders, debounced)
- **Subagent matching** — pending tasks matching swarm subagent descriptions get highlighted with `◔` spinner
- **Markdown round-trip** — `/todo export/import` for persistence and sharing between sessions
- **Notes** — per-task notes via `add_notes` / `update_details`
- **Phase counts** — widget header shows `N active · M pending · K done`
- **Session persistence** — survives hot-reload and session restart

### Web fetch
- **`fetch_url` tool** — no-auth URL fetch (20s timeout, 5MB stream cap, redirect follow); HTML → readable text (dependency-free extractor), JSON → pretty-print, everything else raw; 20k char cap with `max_chars` tuning

### Plugins (declarative bundles)
- **`muselinn.plugin.json`** — six declarative capabilities: `skills` (skill dirs merged into discovery), `sessionStart` (context injected on the session's first turn), `hooks` (merged into the `[[hooks]]` engine), `commands` (.md files become slash commands), plus `mcpServers` / `interface` recorded with skipped-diagnostics
- **Discovery** — project `.pi/plugins/*/` then user `~/.pi/agent/plugins/*/`, first-wins name dedupe; `/plugins` lists capabilities and diagnostics

### Output truncation
- **Oversized tool results spill to disk** — results over 40k chars are written to `<sessionDir>/tool-results/` and replaced in context with a sanitized head+tail preview carrying the `output_path` and read-paging instructions (Kimi `toolResultTruncation` pattern)

## Kimi Code alignment

Against the [Kimi Code CLI docs — Agents & Subagents](https://www.kimi.com/code/docs/kimi-code-cli/customization/agents.html):

| Capability | Status | Notes |
|------------|--------|-------|
| Three built-in subagent types (coder/explore/plan) | ✅ | coder=read/write+bash; explore=read-only; plan=read-only, no shell |
| Context isolation | ✅ | Independent sessions; only final results flow back |
| Parallel dispatch + max_concurrency | ✅ | Real worker-pool cap + progressive launch |
| 30-minute timeout | ✅ | Per-subagent AbortSignal.timeout |
| Background execution (run_in_background) | ✅ | Early task-ID return, blockable task_output, report to output_path |
| Resume an existing subagent | ⚠️ | Conservative semantics: same-id re-run; resume validated (saved state + nothing in flight + remaining items); true session resume pending pi-coding-agent API |
| Nested subagents (coder spawning more) | ❌ | Deliberately closed — no recursive dispatch; subagent toolset excludes agent/agent_swarm |
| Permission inheritance | ✅ | Worker tool calls pass through the shared policy chain; /mode propagates by construction; asks degrade to blocks |
| Instruction-file hierarchy | ✅ | Project `AGENTS.md` / `.kimi-code/AGENTS.md` → `$KIMI_CODE_HOME/AGENTS.md` → `~/.agents/AGENTS.md` |
| wire.jsonl session persistence | ❌ | Subagents use SessionManager.inMemory() (in-process lifecycle) |
| Hooks (`[[hooks]]` lifecycle) | ✅ | All 16 events, exit-code/stdout-JSON block semantics, fail-open |
| Agent Skills (four scopes) | ✅+ | Kimi's four covered and extended to seven pi-native scopes; directory + flat forms; subagent + main-session channels |

## Commands

| Command | Description |
|---------|-------------|
| `/swarm on\|off` | Toggle swarm mode |
| `/cancel` | Cancel current work (two-step confirm) |
| `/resume` | Resume an interrupted swarm |
| `/tasks` | Task browser (`ctrl+shift+t`) |
| `/goal <objective>` | Set a goal |
| `/todo` | Task plan with phase model; shortcuts: `start` `done` `drop` `export` `import` `copy` `edit` `toggle` |
| `/todo toggle` | Expand/collapse the todo panel (replaces former `alt+t`) |
| `/plugins` | List loaded plugins and their capabilities |
| `/swarm-status` | Show status |

> `/goal` `/swarm` `/plan` `/mode` `/tui` all support Tab completion.

## Tools

| Tool | Description |
|------|-------------|
| `agent_swarm` | Batch parallel subagents (`max_concurrency` / `run_in_background` / `output_path` / `model_map`) |
| `agent` | Single subagent |
| `create_goal` / `get_goal` / `update_goal` / `set_goal_budget` | Goal management |
| `enter_plan_mode` / `exit_plan_mode` | Plan mode |
| `ask_user_question` | Tabbed structured questions (multi-select, Other free text) |
| `todo_list` | Model-driven task plan with inline panel |
| `fetch_url` | No-auth URL fetch with content-aware extraction |
| `run_background` / `task_list` / `task_output` / `task_stop` | Background tasks |
| `cron_create` / `cron_list` / `cron_delete` | Cron jobs |

## Architecture

Core/adapter split: `packages/core/` is pure logic with **zero pi imports**
(the future `@muselinn/core` package / MusePi fork foundation); the repo
root holds the pi adapter (entry, pi-tui components, tool registration).

```
pi-muselinn-harness/
├── index.ts               entry (agent_swarm/agent tools, background runner, module wiring)
├── state.ts               shared state
├── packages/core/         @muselinn/core — pure logic, no host imports
│   ├── ports.ts           host contracts (PersistencePort, ScopeDirs)
│   ├── text-utils.ts      visibleWidth & friends
│   ├── shell-output.ts    control-sequence sanitizer
│   ├── truncation/        oversized tool-result spill (pure)
│   ├── webfetch/          HTML→text / JSON extraction (pure)
│   ├── completions.ts     slash-command argument completions
│   ├── ask/               question spec + formatting (pure)
│   ├── todo/              todo model + Kimi folding strategy (pure)
│   ├── plugin/            muselinn.plugin.json manifest parse/discovery
│   ├── goal/              Goal module (state machine, budgets, queue, persistence)
│   ├── plan/              Plan module (tool whitelist, path guard, injection)
│   ├── permission/        Permission module (18-level chain, approval contract)
│   ├── hooks/             Hooks module (TOML mini-parser, executor, 16 events)
│   ├── skills/            Skills module (frontmatter, seven-scope scanner)
│   ├── swarm/             pure swarm half
│   │   ├── types.ts       state/constants (+ goal re-export)
│   │   ├── helpers.ts     braille bars / layout / spinner (memoized)
│   │   ├── estimator.ts   progress estimation (geometric mean)
│   │   ├── widget-lines.ts braille grid line builders (pure)
│   │   ├── wrap-tools.ts  permission gate wrapper (pure)
│   │   ├── resume-guard.ts resume ownership/idle validation (pure)
│   │   ├── report.ts      swarm report formatting
│   │   └── task-list-utils.ts collapse + key routing
│   ├── task/              cron + task persistence state (pure)
│   └── tui/               box/config/parse/switch/timing (pure chrome parts)
├── swarm/                 adapter: subagent execution, /swarm commands,
│                          SwarmWidgetComponent, three-pane task browser
├── task/                  adapter: background task manager (session spawn)
├── tui/                   adapter: MuselinnEditor + event wiring
├── ask/                   adapter: question dialog + ask_user_question tool
├── todo/                  adapter: todo_list tool + inline panel widget
├── webfetch/              adapter: fetch_url tool
├── plugin/                adapter: plugin loader + /plugins command
└── tests/                 node-level unit tests (below)
```

## Tests

Pure node-level unit tests, no model quota needed (19 suites, 590+ assertions):

```bash
npm test                                        # all suites (node tests/run-all.mjs)
```

or individually:

```bash
node tests/permission.test.mjs                    # Permission policy chain + subagent gate — 22
node tests/goal.test.mjs                          # Goal state machine + monotonic restore — 32
node tests/plan.test.mjs                          # Plan mode round-trip + restore validation — 42
node tests/task.test.mjs                          # Task restore/list/output/block + loader runtime — 16
node tests/cron.test.mjs                          # Cron subsystem — 16
node tests/hooks.test.mjs                         # Hooks engine — 43
node tests/skills.test.mjs                        # Skills scan/parse/scopes/discover — 38
node tests/tui.test.mjs                           # TUI collapse/keys/completions/spinner — 62
node tests/tui-box.test.mjs                       # TUI box/config/probe/switch — 61
node tests/ask.test.mjs                           # ask spec/dialog/answers/approval titles — 123
node tests/todo.test.mjs                          # todo model + folding strategy — 21
node tests/shell-output.test.mjs                  # output sanitizer — 21
node tests/truncation.test.mjs                    # tool-result spill — 13
node tests/resume-guard.test.mjs                  # swarm resume validation — 6
node tests/webfetch.test.mjs                      # web extraction — 12
node tests/plugin.test.mjs                        # plugin manifest/discovery — 17
node tests/renderer.test.mjs                      # incremental renderer buffer/tree — 16
node tests/stream-rules.test.mjs                  # stream entry rules — 14
node tests/musepi-config.test.mjs                 # MusePi settings schema — 9
```

The suites run on Node 20/22/24 (20 via `tests/ts-esm-loader.mjs`, a
TypeScript-transpile ESM loader; 22.6+ strips types natively). CI runs the
full matrix — ubuntu + windows × node 20/22 — on every push and PR.

## Releasing (maintainers)
Tag to mark the release (CI publish removed — publish locally with OTP):

```bash
npm run version-patch && git tag v0.9.1 && git push origin v0.9.1
```
## Experimental branches
- [`feature/math-renderer`](https://github.com/MuseLinn/pi-muselinn-harness/tree/feature/math-renderer) — renders `$$...$$` display math in assistant messages via [txm](https://github.com/thatmagicalcat/txm) (cell-based 2D typesetting, works in Windows Terminal; no image protocol). Context-safe: the original Markdown is restored before every LLM call. Enable with `/tui math on` after `cargo install txm`.

## Roadmap

- **MusePi** — the fork track: `@muselinn/core` is extracted (Phase 1 done, `packages/core/` has zero pi imports); next is a self-developed incremental renderer replacing pi-tui with a pi extension API compat layer. See `MusePi-PLAN.md` and `RESEARCH-kimi-code.md`
- **i18n** — bilingual harness UI text and notifications (docs are already split en/zh-CN; the project page has an EN/中 toggle)
- **Math renderer graduation** — merge `feature/math-renderer` once compaction-path context safety is confirmed
- **Clustered diff preview** — kimi-style ±3-line clustered diffs in edit/write approval messages (deferred from the P1 batch)
- **True fullscreen** — container-swap fullscreen (kimi tasks-browser pattern); no alt-screen, preserving terminal scrollback

## Dependencies

- Pi >= 0.80.0
- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-ai`, `@earendil-works/pi-tui` (peers)
- `typebox`

**No companion extensions required** — the harness is fully functional standalone. Since 0.7.4, `ask_user_question` and `todo_list` are built in natively:

> **Upgrading to 0.7.4?** Remove the old companion extensions — they conflict with the built-in tools (pi refuses to start on duplicate tool names):
> ```bash
> pi remove npm:@juicesharp/rpiv-ask-user-question
> pi remove npm:rpiv-todo
> ```

## Acknowledgments

Design and implementation inspired by these open-source projects:

### [Kimi Code](https://github.com/MoonshotAI/Kimi-code) (Moonshot AI)
- Agent Swarm concurrency architecture (max_concurrency worker pool, 30-min timeout, run_in_background)
- Goal system design (GoalActor tracking, Budget Report, blocked 3-turn threshold, context injection)
- Plan-mode lifecycle (enter/exit/approve/reject, ExitPlanMode disk read)
- Permission policy chain (auto/yolo/manual, destructive-always-ask, AGENTS.md priority)
- Cron scheduling (5-field + jitter + 7-day stale + 50 cap)
- TUI component design (braille progress bars, three-pane task browser, `wrapWithSideBorders` closed-box editor)
- Cancel/resume mechanism (AbortSignal chain, UserCancellationError)

### [pi-spark](https://github.com/zlliang/pi-spark) (zlliang)
- Editor top-border info slots (spinner + working state + model embedded in the border)
- Component-replacement TUI customization path (`setEditorComponent` / `setFooter` / `setWidget`)

### [@narumitw/pi-goal](https://www.npmjs.com/package/@narumitw/pi-goal) (narumitw)
- Goal Queue FIFO + auto-switch mechanism
- usage_limited / budget_limited state design
- Wrap-up instruction injection (post-budget behavior)
- Stale Tool Blocking design
- Compaction retention policy

### [pi-codex-goal](https://www.npmjs.com/package/pi-codex-goal) (fitchmultz)
- Goal persistence (appendEntry + session_start restore)
- Goal state transitions
- Budget checking
- Recovery Machine concept (simplified)

---

**Note**: this extension is mostly an independent implementation. Exception: `tui/box.ts`'s `wrapWithSideBorders` is ported from Kimi Code (MIT), with attribution kept in comments and used under the MIT license.

## License

[MIT](LICENSE)
