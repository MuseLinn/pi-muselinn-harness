# Changelog

## 0.9.0

### Features

- **todo phase model** — Full oh-my-pi-style phased TODO: `TodoPhase` with per-task status
  (`pending`/`in_progress`/`completed`/`abandoned`), 7 ops (`init`/`start`/`done`/`drop`/`rm`/`append`/`view`),
  auto-promote first task on init, per-phase progress display, roman numeral phase numbering.
  Widget renders phase tree (`Ⅰ. Scanner · 2/4`) with collapse/expand. (`packages/core/todo/types.ts`, `todo/index.ts`)

- **todo reminder system** — When agent stops with incomplete todos, injects `<system-reminder>`
  with the task list into the next turn's context (max 3 reminders, debounced).
  (`todo/index.ts`)

- **todo markdown round-trip** — `phasesToMarkdown` / `markdownToPhases` for `/todo` export/import.
  (`packages/core/todo/types.ts`)

### Changes

- **Tool rename** — Remains `todo_list` (backward-compatible with permission system / stream-rules /
  tool-policy). Schema changed from `{action, todos}` to `{op, list?, task?, phase?, items?}`.

- **Session persistence** — Format changed from `{todos}` to `{phases}`; `restoreTodos` auto-converts
  old flat format to a single `Tasks` phase on hot-reload.

### CI

- **Test matrix** — Bumped from `[20, 22]` to `[22, 24]` (Node 20 deprecated on runner).
  (`.github/workflows/test.yml`)

- **Remove CI publish** — `npm publish` job removed from `publish.yml`; publish done locally with OTP
  (npm granular token bypass-2FA deprecated for direct publishing).
  (`.github/workflows/publish.yml`)

## 0.8.2

### Features (kimi-code 0.29.0 alignment)

- **agent-file** — Custom Agent Files: Markdown agent profiles with YAML frontmatter.
  Discovery from project scope (`.pi/agents/`, `.kimi-code/agents/`, `.agents/agents/`)
  and user scope (`~/.pi/agent/agents/`, `~/.kimi-code/agents/`, `~/.agents/agents/`).
  Profiles support `tools`/`disallowedTools`/`subagents` restrictions and `${base_prompt}`
  expansion. Two new tools: `agent_file_list` (browse profiles) and `agent_file_info`
  (inspect a profile). The `agent` and `agent_swarm` tools accept an `agent_file` parameter
  to load a profile, which overrides the subagent's system prompt and applies tool gating.
  (`packages/core/agent-file/` — 5 files, 1.7 KB total)

- **tool-gating** — Three-layer tool policy (Profile → Session runtime) integrated into
  the existing 18-level permission chain. Agent file profiles can restrict which tools
  a subagent may use via `tools` (allow-list) and `disallowedTools` (deny-list). The
  `PermissionManager.evaluate()` checks `ToolPolicyService.isActive()` first before
  running the policy chain, so tool gating applies to all tool calls including direct
  LLM invocations. (`packages/core/tool-policy/` — 3 files)

- **agent-lifecycle** — Event bus for agent lifecycle tracking: `agent.created` and
  `agent.disposed` events emitted by `runSubAgent`. Active agent count displayed in
  the status bar (`[N agents running]`). The `AgentLifecycle` service supports
  subscriptions and active agent enumeration.
  (`packages/core/agent-lifecycle/` — 2 files)

### Permission & Plan Mode Overhaul (kimi-code alignment)

- **Policy chain reordered** — `AutoApprove` now fires BEFORE destructive/sensitive/git
  safety checks, making auto mode truly automatic (no dialogs). YOLO mode still respects
  safety checks (destructive commands, `.env` access, `.git` paths) before auto-approving.
  Aligned with kimi-code's auto-vs-yolo semantics. (`packages/core/permission/policies.ts`)

- **READ_ONLY_TOOLS expanded** — From 6 to 20 tools, matching kimi-code's default-tool-approve
  set: added `glob`, `read_media_file`, `task_list`, `task_output`, `cron_list`,
  `agent_file_list`, `agent_file_info`, `todo_list`, `enter_plan_mode`, `exit_plan_mode`,
  `skill`, `select_tools`. (`packages/core/permission/types.ts`)

- **Plan mode gates `task_stop`/`cron_create`/`cron_delete`** — Kimi Code-style: planning
  sessions cannot stop tasks or modify cron schedules. (`packages/core/plan/index.ts`)

- **Plan mode injection variants** — Full reminder on first injection or after user message;
  sparse (short) reminder on consecutive assistant turns to avoid prompt bloat.
  (`packages/core/plan/index.ts`)

- **Auto-mode ExitPlanMode warning** — When auto-approved, the tool output now warns
  "the user has NOT explicitly approved it" (kimi-code parity).
  (`packages/core/plan/tools.ts`)

## 0.7.9

### Features

- **plan** — Revise 反馈输入：审批面板选 Revise 后弹出文本输入框收集用户修改意见，
  反馈内容持久化到 `PlanData.revisionFeedback` 并注入到 plan mode system prompt，
  模型回到 plan mode 后有方向地修改（`packages/core/plan/types.ts` / `index.ts` / `tools.ts`）

## 0.7.8

### Fixes

- **task** — `run_background` tasks died at spawn on pi ≥ 0.81 (`task_output` empty, `block:true` returned immediately): the subagent resource loader's `getExtensions()` omitted `LoadExtensionsResult.runtime`, which pi 0.81 passes straight into `ExtensionRunner.bindCore()` (`Cannot set properties of undefined (setting 'sendMessage')`), so `createAgentSession` threw and every background task failed instantly. The loader now includes `createExtensionRuntime()` when the SDK provides it (still compatible with pi 0.80.x, which neither exports it nor reads it)
- **task** — `task_list` with no arguments threw `Cannot read properties of undefined (reading 'slice')` while `active_only:true` worked: restored legacy/foreign persisted entries carry the task text as `description` (or not at all), and the full-list formatter called `prompt.slice()` on `undefined`. `computeRestoredTask` now maps `description` → `prompt` and defaults missing/non-string prompts to `""`; the list formatter is additionally defensive per row
- **task** — `task_output` on a task that failed before producing output now surfaces `[task failed: <error>]` instead of a bare empty string
- **plan** — duplicate `muselinn_plan` appends eliminated (observed: 5 identical entries within 25 s): `PlanManager.persist()` now skips the append when the serialized state is identical to the last persisted one, and `restoreFromData()` seeds the dedup baseline so a post-restore no-change persist doesn't re-append

### Tests

- **task** — new `tests/task.test.mjs` (16 checks): restore prompt defaulting, full-list rendering of prompt-less restored tasks, `block:true` waits for completion and returns the real report, timeout returns partial output, failed-task error surfacing, resource-loader runtime shape
- **plan** — `tests/plan.test.mjs` gains persist-dedup cases (repeat lifecycle persists skipped, real changes still persist, post-restore no-change deduped, stale-restore correction persists exactly once)

## 0.7.7

### Fixes

- **plan** (`dbc917c`) — rtk-wrapped bash gate + revise-preserving review flow + restore validation
  - bash read-only gate peels env assignments and a leading `rtk` wrapper (pi-rtk-optimizer rewrites commands in place; the gate now vets the rewritten string) and accepts Windows `dir` listings
  - `enter_plan_mode` seeds a placeholder plan file; exit syncs in-memory content from disk so the review panel never shows a stale/empty plan
  - `reenterForRevision()`: Revise / a cancelled review keeps the **same** plan object (id / path / content) instead of trapping the user or losing work; review timeout 60 s → 600 s
  - `validateRestoredState()`: a stale persisted active-plan entry with no content and no file on disk deactivates plan mode instead of silently trapping the session
  - plan state persists on every change; goal + plan restore runs **before** the session_start badge section; tool-driven plan mode sets/clears the footer badge just like `/plan`
- **goal** (`95bc30c`) — monotonic badge counters + pure-display tick + verified=true completion docs
  - the footer badge no longer restores from persisted entries on every 1 s tick / `turn_end` — restore happens at session_start and (restore-if-empty) at goal tool entry points, so `turns` no longer flickers
  - `restoreFromData` merges counters monotonically (max) for the same goalId — a stale entry can never pull turns / tokens / wall-clock backwards
  - `clear()` appends a complete-status tombstone entry; both restore paths treat a latest `complete` entry as ended, so a completed goal can't be resurrected with stale counters
  - `create_goal` / `update_goal` docs and parameter descriptions now state explicitly: with a declared `completion_criterion`, `status='complete'` is refused unless `verified=true` is passed in the same call

### Features

- **ask** — tabbed multi-question dialog (`c0f9668`): 1–4 questions in one dialog with per-question header tabs, `multi_select` checkboxes, and an automatic free-text **Other** option; plus ask dialog robustness (`02073ed`) — scrolling window for long option lists, answer deduplication, and background-question support

### Internal

- **core** (`6b637ed`) — cross-module `export let` state replaced with `export const` containers (jiti 2.7.0 stale-namespace snapshots made importers observe stale state)
- **tui** (`5d0134c`) — spinner rides pi's natural renders (wall-clock frame); the keep-alive timer skips busy periods
- **tests** — portable jiti resolution (`tests/jiti-path.mjs`, no more machine-specific absolute path), `npm test` runner (`tests/run-all.mjs`) with per-node-version TS loading, and a TypeScript-transpile ESM loader for Node 20 (`tests/ts-esm-loader.mjs`)
- **ci** — GitHub Actions: push/PR test matrix (ubuntu + windows × node 20/22) and tag-triggered (`v*`) npm publish with the test matrix as gate

## 0.7.6

- README: absolute GitHub link for MusePi-PLAN.md (jsdelivr 404 on npm), softened maintenance wording, screenshot hosted via GitHub Pages (raw.githubusercontent 404s while the repo is private)

## 0.7.5

- Project page: 0.7.4/0.7.5 highlights, MusePi section, refreshed roadmap; eight-module zh intro

## 0.7.4

- Native `ask_user_question` tool and `todo_list` tool + inline panel (`alt+t`) — replaces the external rpiv companion packages
- Approval panel with per-tool titles, number-key selection, reject-with-reason (manual permission tier)
- Swarm permission gating with `/mode` broadcast; subagent resume guard; oversized tool results truncated to disk with `output_path`; no-UI permission blocks state NOT-executed explicitly
- Verified against pi 0.81.x
