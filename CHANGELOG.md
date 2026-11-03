# Changelog

All notable changes to pi-muselinn-harness, in reverse chronological order.

## 0.9.23

**Question dialog concurrency and dependency compatibility:**

- Declared `ask_user_question` with `executionMode: "sequential"` to prevent foreground dialogs in the same tool-call batch from overwriting each other and leaving calls hanging. Added behavioral regression coverage for this scenario.
- Fully preventing overlap between foreground and background dialogs requires pi >= 1.4.0. On older pi versions, `background: true` remains outside the guarantee.
- Moved `typebox` from dependencies to peer dependencies (`"*"`) so the host supplies the shared dependency.

## 0.9.22

**Type-layer hardening — full-package `tsc` typecheck (first time):**

- Added `tsconfig.json` (es2024, bundler resolution, strict), `npm run typecheck`, and a typecheck step in CI. The runtime-JIT test strategy (node type stripping) erased all annotations, so type breakage was invisible to the suite — 158 strict errors cleared.
- Fixed broken type references: root `index.ts` referenced a non-existent `./types` module for `SubAgentTask`/`SwarmState` (4 sites) — now the real `packages/core/swarm/types` import; `permission/config.ts` was missing the `PermissionMode` import; `todo/index.ts` read a non-existent `SubAgentTask.description` (dead branch removed).
- `swarm/subagent.ts` `ResourceLoader` shim was missing `getSystemPromptSource`/`getAppendSystemPromptSources` (pi 0.83 requires them) — added.
- Removed dead `usage` fields from every `registerCommand` — pi 0.83 never reads `cmd.usage` (verified against dist runtime).
- Fixed silently-dead behavior: `resources_discover` skill injection called an unimported `listDiscoverableSkillFiles` (ReferenceError swallowed by `catch` — subagent skills silently missing); `session_end` does not exist in pi 0.83's event table (todo cleanup now bound to `session_shutdown`); single-agent `SubAgentTask` literals were missing required `toolCalls`/`estimatedTotalCalls`.
- Type-gap closures: `notify(..., "success")` is runtime-supported but absent from pi's type (module augmentation in `notify-augment.d.ts`); `AutocompleteItem` imported from `@earendil-works/pi-tui` (pi-coding-agent doesn't re-export it) with the required `label`; `Type.Optional(record, { description })` dropped its 2nd arg (description moved into `Type.Record` options); `createAgentSession` no longer passes the unsupported `modelRegistry` option; model reads now use pi's real `Model` type (vision detection via `model.input` type-safe); `TurnEndEvent` signal access guarded for multi-version compat.

## 0.9.21

**Window-aware tool-result spill (issue #2):**

- The 40k-char spill threshold was hardcoded and unaware of the model's
  context window — a 1M-context model was forced through the same disk
  spill + `read` round-trip as an 8k one. The threshold now scales with
  `ctx.model.contextWindow` (`max(40k, window × 4 chars/token)`, capped at
  800k chars ≈ 200k tokens so a single tool result can never balloon the
  context), and `PI_TRUNCATION_THRESHOLD` overrides it explicitly. Small
  windows keep the exact previous behavior.

**RPC approval dialog (issue #4) — no more silent denials in RPC hosts:**

- In pi RPC mode (obsidian-pi & other embedding clients) the approval dialog
  previously rendered through the TUI-only `ctx.ui.custom` path, which RPC
  hosts don't implement: every `ask` verdict in manual mode silently
  returned `User denied: <policy>` and the user never saw a prompt. The
  approval dialog now detects non-TUI hosts (`ctx.mode !== "tui"`) and
  falls back to the extension UI protocol that RPC hosts do implement —
  `select` (Allow once / Always allow / Deny / Deny with reason) with
  `input` for the deny reason and `confirm` as a last resort. Cancelling
  the reason input returns to the options (TUI parity); any host-side UI
  failure degrades to a fail-safe deny.

## 0.9.20

**Hotfix — npm package was missing the `pause/` adapter directory (issue #3):**

- The `files` whitelist in package.json did not include `pause/`, so the
  0.9.19 tarball shipped without `pause/commands.ts` and the extension
  failed to load (`Cannot find module './pause/commands'`). The directory
  is now part of the published package.

## 0.9.19

**Freeze & steer — `/pause` · transcript · `/steer`:**

- **`/pause` full-screen freeze** — the main agent and every swarm subagent
  park at their next safe boundary (tool-call gate): in-flight calls run to
  completion, nothing is aborted, and a later release continues exactly where
  each loop parked. A full-screen overlay (theme-colored pause glyph + live
  hold timer, terminal background as the backdrop) covers the terminal;
  esc/enter/space/ctrl+c releases. Releasing leaves a status line in the
  session transcript (`已恢复（暂停 13s）— 代理继续运行`), omp-style.
- **Transcript recording** — every subagent's conversation is written to
  `<sessionDir>/agents/<taskId>/wire.jsonl` (user / assistant → tool-call
  lines with timestamps, stop reasons and usage; tool arguments deliberately
  omitted). The task browser (`/tasks`, `ctrl+shift+t`) gains a conversation
  view (`c` key) showing formatted transcript lines.
- **`/steer <taskId> <message>`** — injects a message into a running subagent
  (swarm session or background task; Tab-completed task ids); the agent loop
  delivers it once the current tool call completes.
- **Pause overlay rendering fixes** — colors come from the active theme
  (`accent`/`text`/`muted`/`dim`), and block glyphs (█ / ⏸) are measured
  single-width so the pause symbol centers exactly with the text below.

## 0.9.18

**Persistent startup permission mode:**
- `"defaultMode": "auto" | "yolo" | "manual"` in `~/.pi/agent/permissions.json`
  (global) or `.pi/permissions.json` (project; global wins on conflict)
  replaces the hardcoded `manual` startup mode — new sessions start in your
  preferred mode without an interactive `/mode` call. Sessions with a
  recorded `/mode` history still restore the last used mode; `defaultMode`
  is the starting point for fresh sessions. Thanks @jason-in-hub for the
  contribution (PR #1)!

## 0.9.17

**Miscellaneous:**
- README (EN/中): releasing instructions moved from the user-facing README
  to the bottom of `CHANGELOG.md` (maintainer-only workflow); the release
  tag command now derives the version dynamically instead of a stale
  hardcoded `v0.9.1`.

## 0.9.16

**todo_list tool prompts de-ambiguated:**
- `op=init` now unambiguously requires `list=[{phase, items}]`; the top-level
  `items` field is documented as plain strings only (append), removing the
  "flat init fallback" phrasing that led models to pass object arrays and get
  schema validation errors (`items.0: must be string`).

## 0.9.15

**Todo widget auto-clear (OMP parity):**
- Closed (completed/abandoned) tasks are now removed from the plan after
  `PI_MUSELINN_TODO_CLEAR_DELAY` seconds (default 60, `0` = instant,
  `-1` = manual `/todo rm`) — finished plans fade out of the above-editor
  panel instead of lingering. The completion state shows briefly with a
  live countdown hint. New pure helper `removeClosedTasks()`; the timer is
  re-armed on every todo mutation and session restore, cancelled on session
  end.

## 0.9.14

**Startup fix:**
- `session_start` model catalog refresh is now fire-and-forget instead of
  awaited — a stalled catalog fetch (no signal/timeout) previously blocked the
  TUI input loop right after the interface rendered. Matches pi core's own
  background refresh behavior in `main.ts`.

**TUI polish:**
- **Shimmer working message (OMP-style)** — the editor border's working label
  gets a wall-clock driven light-band sweep (`classic` cosine band or `kitt`
  K.I.T.T. scanner, default classic); the crest paints accent+bold so dim text
  stays legible mid-animation. New `packages/core/tui/shimmer.ts` (pure, zero
  pi imports; ported from oh-my-pi, MIT) with three-tier palettes, ANSI run
  coalescing and a compiled-palette cache. `/tui shimmer <classic|kitt|disabled>`
  switches live, persisted to `muselinn-tui.json`.
- **Boxed editor spacing** — padding minimum 2 so the `│` bars never touch the
  text/cursor, and a `❯` prompt chevron on the first content line.
- **Stable animation frame-rate** — keep-alive timer uses a fixed 200ms quiet
  gate (~10fps ceiling), so a stalled
  agent loop costs at most ~10 full-tree renders per second even on very large
  sessions, and the cadence never changes (adaptive thresholds were tried and
  rejected — latency noise made the frame rate stutter).

**Docs & site:**
- README restructured for new users (what-is-this table, quick start) and the
  11 versions of release notes moved to a dedicated `CHANGELOG.md`; Pages
  home reworked with a quick-start section and a changelog page.
- Pages demo terminal now simulates the actual Pi + harness TUI: quiet-startup
  header, loaded-resources block, braille swarm grid widget, `╭╮│╰╯` boxed
  editor with spinner + model in the border, and the status-bar badges
  (permission mode / swarm / goal / agent count).

## 0.9.13

**Plan mode Kimi Code full alignment:**
- Plan injection rewritten to match Kimi Code's `plan-mode.ts` wording (full + sparse variants).
- `enter_plan_mode`, `exit_plan_mode`, and plan-file writes auto-approved (skip permission chain).
- Per-tool deny messages: TaskStop, CronCreate, CronDelete get specific reasons in plan mode.
- `isPlanFilePath()` shared helper for consistent plan-file path matching.
- Plan approval panel shows full file content (removed 500-char truncation).

**Permission dialog UX:**
- "Deny with reason" input: Esc now returns to the 4 options instead of ending the flow.
- Looped dialog matches the plan approval panel's Revise pattern.

**Subagent profile system:**
- New `packages/core/profile/` with CODER / EXPLORE / PLAN profiles.
- Tool permissions aligned with Kimi Code YAML definitions (bash in explore, no write in plan).
- Profiles injected via `buildProfileTools()` + `createSubagentResourceLoader()`.

**Preview box fix:**
- Trimmed Markdown trailing whitespace so box borders don't exceed terminal width.
- Accounted for pi-tui `Text` component's `paddingX=1` in stacked layout.

**Misc:**
- Replaced `theme.fg("info", ...)` with `theme.fg("accent", ...)` ("info" color didn't exist).
- `hasAnyPreviewOption()`: "n note" hint only shows when an option has a preview.
- Questionnaire arrow-key tab switching uses `matchesKey()` (Kitty protocol compatible).
- All 19 test suites green.

## 0.9.12

- Made `resources_discover` handler async and added timing.
- Wrapped `restoreTodos`, `bindTodoSession`, `refreshWidget`, and `loadPlugins` in try/catch.
- Removed unused `VisibleTodos` / `selectVisibleTodos` dead code (78 lines).
- Cleaned up MusePi fork references from README and docs.

## 0.9.11

- **Swarm report includes subagent output** — model sees what each subagent
  produced (Kimi Code parity).
- **Tool policy gate** — disabled tools blocked before permission chain.
- **Plan mode Kimi Code alignment** — bash no longer blocked in plan mode;
  only Write/Edit (outside plan file), TaskStop, Cron mutations blocked.
- All 12 test suites green

## 0.9.10

- **Ask dialog `n` note always visible** — Footer shows `· n note` unconditionally; any option can carry a note (OMP parity).
- All 12 test suites green

## 0.9.3–0.9.8

**Integration & consistency fixes:**
- Widget API fixed: `ctx.widget()` → `ctx.ui.setWidget("todo", content)`, empty list clears widget instead of showing "(empty)" clutter
- `/todo` subcommands aligned with oh-my-pi: `view` → `export`, added `copy`, `edit`, bare `/todo` prints Markdown
- Every `/todo` subcommand produces status feedback via `ctx.showStatus`
- Removed redundant `/todo help` / `?` (command registry provides discoverability)
- `clearTodoSession` now wired to `session_end` event (was imported but never called)
- `require()` → ES `import` for `swarmState` (require silently failed in bundled ESM runtime — subagent matching finally works)
- All 12 test suites green at every commit

## 0.9.1

**Bug fixes:**
- Fixed `add_notes` case in `applyEntry` — no longer falls through into `update_details` (all add_notes calls rejected with "Missing details value")
- Fixed stray `completed: number` in function body that blocked module parsing
- `todoMatchesAnyDescription` now correctly checks shorter string against longer one for substring matching
- All 94 TODO tests green, full suite 12/12

## 0.9.0

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

## 0.8.2

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

## 0.7.8

- **Task module reliability fixes** — the two root causes behind broken background tasks on pi ≥ 0.81:
  - `run_background` died at spawn (`task_output` empty, `block:true` returned instantly): the subagent resource loader omitted `LoadExtensionsResult.runtime`, which pi 0.81's `ExtensionRunner.bindCore` requires — `createAgentSession` threw and every background task failed immediately. The loader now includes the runtime when the SDK provides it (still 0.80-compatible)
  - `task_list` crashed with no arguments while `active_only:true` worked: restored persisted entries carry the task text as `description` (or not at all), and the list formatter called `prompt.slice()` on `undefined`. Restore now maps `description` → `prompt` and defaults missing prompts; `task_output` also surfaces `[task failed: <error>]` for tasks that died before producing output
- **Plan persistence dedup** — `PlanManager.persist()` skips appends identical to the last persisted state (observed: 5 identical `muselinn_plan` entries within 25 s), and restore seeds the dedup baseline so a no-change persist doesn't re-append
- **Tests** — new `task.test.mjs` suite (16 checks) + plan dedup regression cases; 19 suites / 580 assertions, all green

## 0.7.7

- **Plan mode fixes** — the bash read-only gate now understands `rtk`-wrapped commands (pi-rtk-optimizer rewrites commands in place) and Windows `dir`; **Revise** keeps the same plan object instead of trapping you or losing work; review timeout raised 60 s → 600 s; a stale persisted plan with no file on disk deactivates cleanly instead of trapping the session; the `plan` badge now also follows tool-driven plan mode
- **Goal fixes** — footer badge counters (`turns` / tokens / wall-clock) restore monotonically, so they never flicker backwards; completed goals leave a tombstone entry and can't be resurrected with stale counters; `update_goal` docs now state the `verified=true` rule explicitly (required to complete a goal with a declared criterion)
- **Ask dialog robustness** — scrolling window for long option lists, answer deduplication, and background-question support, on top of the tabbed multi-question dialog (multi-select + free-text Other)
- **CI/CD** — GitHub Actions test matrix (ubuntu + windows × node 22/24) on every push/PR

## 0.7.4

- **`ask_user_question` tool** — native interactive question dialog with numbered options, shared with the approval flow
- **`todo_list` tool + inline panel** — session-shared todo with collapse policy (replaces external rpiv-todo)
- **Approval panel** — per-tool titles, number-key selection, reject-with-reason (manual permission tier)
- **Swarm permission gating** — shared permission manager; `/mode` broadcasts to all subagents
- **Editor anchoring** — input anchored after slash-menu closes (render-edge detection)
- **`toolResultTruncation`** — oversized tool results persisted to disk with preview + `output_path`
- **Subagent resume guard** — ownership/idle validation before resuming
- **`fetch_url` tool** — no-auth URL fetching (replaces external dependency)
- **Plugin manifest** — six-piece package metadata set


![Closed-box editor with streaming state in the top border](https://muselinn.github.io/pi-muselinn-harness/assets/img/pi-boxed-editor.png)


---

## Releasing (maintainers)

Changelog entries describe **user-visible changes only** — CI/tooling/docs
housekeeping stays in git history, not release notes (the release body is
generated from CHANGELOG.md, so it inherits this rule).

Tag to mark the release (CI publish removed — publish locally with OTP):

```bash
npm run version-patch                              # bumps package.json + lock (e.g. 0.9.16 → 0.9.17)
git tag v$(node -p "require('./package.json').version")
git push origin main --tags                        # tag push runs CI + auto-creates the GitHub Release
npm publish                                        # manual publish with OTP
```
