# pi-muselinn-harness

Kimi Code 风格的 Pi Agent 扩展 — Swarm + Goal + Plan 三模块架构。

## 功能

### Swarm 模块
- **子代理执行** — `createAgentSession()` in-process 执行
- **并发控制** — `runParallel()` + 指数退避重试
- **智能模型路由** — 从 `ctx.modelRegistry` 自动发现，任务感知选择
- **盲文进度条** — 80ms tick 驱动动画
- **三栏任务浏览器** — 键盘导航 + 分页
- **取消/恢复** — UserCancellationError + AbortSignal 链

### Goal 模块
- **Goal 生命周期** — active / paused / blocked / complete / usage_limited / budget_limited
- **Budget 三重检测** — tokenBudget + turnBudget + wallClockBudgetMs
- **Goal Queue** — FIFO + Auto-switch + prioritize/drop/skip
- **持久化** — appendEntry + session_start 恢复
- **Context 注入** — `<untrusted_objective>` 标签注入 system prompt
- **Recovery** — Compaction 保留 + Context Overflow 检测 + 429 检测
- **Tool 阻止** — 预算耗尽后阻止 tool 执行

### Plan 模块
- **Plan Mode** — LLM 先探索代码库、写计划、审批后再执行
- **工具限制** — 只允许只读工具 + plan 文件
- **Context 注入** — 注入 plan 到 system prompt

## 安装

```bash
pi install local:~/.pi/agent/extensions/pi-muselinn-harness
```

## 命令

| 命令 | 说明 |
|------|------|
| `/swarm on\|off` | 开关 Swarm 模式 |
| `/cancel` | 取消当前任务 |
| `/resume` | 恢复任务 |
| `/tasks` | 打开任务浏览器 |
| `/goal <objective>` | 设置目标 |
| `/goal pause\|resume\|cancel` | 管理目标 |
| `/goal queue` | 查看队列 |
| `/goal add\|prioritize\|drop\|skip` | 队列操作 |
| `/plan` | 切换 Plan Mode |
| `/plan on\|off\|clear` | Plan Mode 控制 |
| `/swarm-status` | 查看状态 |

## 工具

| 工具 | 说明 |
|------|------|
| `agent_swarm` | 批量并行子代理 |
| `agent` | 单个子代理 |
| `create_goal` | 创建目标 |
| `get_goal` | 查询目标 |
| `update_goal` | 更新目标状态 |
| `enter_plan_mode` | 进入 Plan Mode |
| `exit_plan_mode` | 退出 Plan Mode |

## 架构

```
pi-muselinn-harness/
├── index.ts          入口
├── state.ts          共享状态
├── swarm/            Swarm 模块
│   ├── subagent.ts   子代理执行
│   ├── commands.ts   /swarm /cancel /resume
│   ├── widget.ts     TUI 组件
│   ├── task-browser.ts 三栏浏览器
│   └── helpers.ts    盲文进度条
├── goal/             Goal 模块
│   ├── index.ts      GoalManager
│   ├── commands.ts   /goal 命令
│   ├── tools.ts      create/get/update_goal
│   ├── budget.ts     Budget Report
│   ├── persistence.ts 持久化
│   └── queue.ts      Goal Queue
└── plan/             Plan 模块
    ├── index.ts      PlanManager
    ├── commands.ts   /plan 命令
    ├── tools.ts      enter/exit_plan_mode
    └── injection.ts  Context 注入
```

## 依赖

- Pi >= 0.80.0
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

## 参考

- [Kimi Code](https://github.com/MoonshotAI/Kimi-code) — Agent Swarm + Goal + Plan 设计
- [@narumitw/pi-goal](https://www.npmjs.com/package/@narumitw/pi-goal) — Goal Queue + Recovery
- [pi-codex-goal](https://www.npmjs.com/package/pi-codex-goal) — Goal Persistence + Recovery Machine

## License

MIT
