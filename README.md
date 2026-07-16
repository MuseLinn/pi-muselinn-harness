# 🐝 pi-muselinn-harness

Agent orchestration harness for Pi — from swarm parallel execution to goal management.

## Features

| Feature | Tool/Command | Description |
|---------|-------------|-------------|
| 🚀 **Swarm** | `agent_swarm` | Batch parallel sub-agents with template |
| 🤖 **Agent** | `agent` | Single sub-agent dispatch |
| 📊 **Progress** | TUI widget | Kimi Code-style braille grid, tick-driven animation |
| 🎯 **Goal** | `/goal` | Lifecycle manager: create/pause/resume/block/complete |
| 📋 **Tasks** | `/tasks` | 3-panel Kimi Code-style task browser |
| ❌ **Cancel** | `/cancel` | Two-step confirmation, cascade to all children |
| 🔄 **Resume** | `/resume` | Resume interrupted swarm with resume_agent_ids |
| ❓ **Question** | `question` tool | Single interactive question with options + custom input |
| 📝 **Questionnaire** | `questionnaire` tool | Multi-question tab-based UI |
| 📊 **Status** | `/swarm-status` | Show swarm + goal + resume state at a glance |

## Architecture

```
12 modules, 3163 lines, in-process (createAgentSession)
├── types.sh → types, animation ticks, Goal types, global state
├── helpers.ts → tick-driven accumulatedBrailleBar, grid layout
├── widget.ts → TUI grid with 80ms frame, 360ms fill animation
├── subagent.ts → ResourceLoader, UserCancellationError, linkAbortSignal
├── goal.ts → GoalManager (active/paused/blocked/complete)
├── commands.ts → /goal /cancel /resume /tasks /swarm-status
├── task-browser.ts → 3-panel TasksBrowserComponent
├── question-tool.ts → Interactive single question
├── questionnaire-tool.ts → Multi-question tab-based UI
└── index.ts → Entry: registers tools + commands
```

## Install

```sh
pi install ~/.pi/agent/extensions/pi-muselinn-harness
```
