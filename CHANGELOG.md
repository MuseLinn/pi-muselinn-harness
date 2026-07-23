# Changelog

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
