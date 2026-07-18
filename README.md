# pi-muselinn-harness

Kimi Code 风格的 Pi Agent 扩展 — Swarm + Goal + Plan + Permission + Task + Hooks + Skills 七模块架构，全面对齐 Kimi Code 的子系统行为。

## 功能

### Swarm 模块
- **子代理执行** — `createAgentSession()` in-process 执行
- **并发控制** — `runProgressive()` worker 池，真实 `max_concurrency` 上限 + 指数退避重试
- **30 分钟超时** — 每个子代理独立 `AbortSignal.timeout`(30min，对齐 Kimi Code)
- **run_in_background** — swarm 整体转后台任务，早返回 task ID，报告可落 `output_path`
- **智能模型路由** — 从 `ctx.modelRegistry` 自动发现，任务感知选择
- **盲文进度条** — 真实工具调用进度驱动，250ms 帧 + 状态指纹门控(未变帧零成本跳过)
- **自适应布局** — pi-tui Component 协议渲染，状态栏宽度随终端自适应(10–60)，窄终端不错位
- **三栏任务浏览器** — 状态字形(○ pending / ◐ running / ✓ done / ✗ failed / ▲ aborted)+ 完成行删除线、溢出折叠(`+N more`,优先保留 running)、命名键位路由(跟随用户自定义键位)、`ctrl+shift+t` 快捷键
- **取消/恢复** — UserCancellationError + AbortSignal 链，`/cancel` 两步确认

### Goal 模块
- **Goal 生命周期** — active / paused / blocked / complete / usage_limited / budget_limited
- **Active Guard** — 已有 active 目标时 `create_goal` 拒绝静默覆盖，需 `replace=true` 或 `/goal replace`
- **Blocked 3 轮阈值** — 同一原因连续 3 次 block 才真正进入 blocked
- **完成判据门禁** — 声明了 `completionCriterion` 时，未验证通过不允许 complete
- **Budget 三重检测** — tokenBudget + turnBudget + wallClockBudgetMs,`set_goal_budget` 支持 turns/tokens/ms/s/min/hours
- **Goal Queue** — FIFO + high/normal 优先级 + Auto-switch + prioritize/drop/skip
- **持久化** — appendEntry + session_start 恢复
- **Context 注入** — `<untrusted_objective>` 标签注入 system prompt
- **Recovery** — Compaction 保留 + Context Overflow 检测 + 429 检测

### Plan 模块
- **Plan Mode** — LLM 先探索代码库、写计划、审批后再执行
- **工具限制** — 只读工具白名单 + plan 文件写权限，bash 按命令白名单放行
- **ExitPlanMode 读盘** — 呈现时读取 plan 文件真实内容，与 LLM 写盘保持一致
- **路径守卫** — `path.resolve` + `startsWith(planDir)` 防绕过
- **Context 注入** — 注入 plan 到 system prompt

### Permission 模块
- **18 级策略链** — auto / yolo / manual 三模式，安全策略(destructive、敏感文件)优先于模式短路
- **Destructive 检测** — `rm -rf` / `git push --force` / `drop table` / `git reset --hard` 等正则识别，每次必问，不被会话批准短路
- **敏感文件守卫** — `.env` / `id_rsa` / `*.key` 等读写拦截，auto 模式下也不放行
- **会话批准指纹** — 按 sessionId + 输入指纹记忆批准，不蜕变为"永久许可"
- **AGENTS.md 指令** — 对齐 Kimi Code 指令文件层级,聚合生效:项目级(最近的 `AGENTS.md` 或 `.kimi-code/AGENTS.md`)→ 全局 `$KIMI_CODE_HOME/AGENTS.md`(默认 `~/.kimi-code/AGENTS.md`)→ 跨工具 `~/.agents/AGENTS.md`;`destructive-ask-always` 可将 ask 升级为 deny
- **配置缓存** — 权限配置按文件 mtime 缓存，变更即时生效

### Task 模块(后台任务 + 定时任务)
- **run_background** — 子代理后台执行，立即返回 task ID;`output_path` 把完整输出落盘供 Read 分页
- **30 分钟超时** — 后台任务超时自动失败(`stopReason=timeout_30min`)
- **task_list / task_output / task_stop** — `active_only` 过滤、`block+timeout` 等待完成、`offset/limit` 分页
- **50 任务上限** + **7 天 stale 清理** + 重启孤儿任务降级 `process_restart`
- **增量持久化** — 单任务变更只 append 单条 entry,restore 兼容旧快照
- **Cron 定时任务** — 5 字段 cron(本地时区)+ 确定性 jitter(实测周期 10%,上限 15min)+ recurring/one-shot + 50 上限 + 7 天 stale 自动删

### Hooks 模块
- **Kimi Code 对齐的 `[[hooks]]` 引擎** — 读取 `$KIMI_CODE_HOME/config.toml`(默认 `~/.kimi-code/config.toml`)+ 项目级 `.kimi-code/config.toml`,支持 event/matcher/command/timeout 四字段
- **全事件覆盖** — UserPromptSubmit / PreToolUse / Stop(可阻断)+ PostToolUse / PostToolUseFailure / PermissionRequest / PermissionResult / SessionStart / SessionEnd / SubagentStart / SubagentStop / StopFailure / Interrupt / PreCompact / PostCompact / Notification(观察型)
- **退出码语义** — `0` 放行(stdout 附加上下文)、`2` 阻断(stderr 为原因)、其他/超时/崩溃 fail-open;支持 stdout JSON `permissionDecision: deny`
- **内置 TOML 迷你解析器** — 零依赖,非法规则 warn 跳过不炸扩展;mtime 缓存热加载
- **安全网** — Stop 连续阻断 3 次自动停止注入(防死循环);所有触发镜像到 `pi.events` 供其他扩展订阅

### Skills 模块
- **Kimi Code 四级作用域扫描** — 项目级 `.kimi-code/skills`、`.agents/skills` → 用户级 `$KIMI_CODE_HOME/skills`、`~/.agents/skills`,项目优先按 name 去重
- **目录型 + 扁平型** — `SKILL.md` 子目录(可带辅助文件)与单 `.md` 文件,frontmatter 全字段(name/description/type/whenToUse/disableModelInvocation/arguments,含横杠/下划线变体)
- **子代理可用** — swarm 与后台任务的子代理 session 经 resourceLoader 拿到 skills;主会话经 `resources_discover` 注入同一批目录
- **零依赖 frontmatter 解析器** + mtime 目录树缓存

## 与 Kimi Code 的对齐情况

对照 [Kimi Code CLI 官方文档 — Agent 与子 Agent](https://www.kimi.com/code/docs/kimi-code-cli/customization/agents.html):

| 能力 | 状态 | 说明 |
|------|------|------|
| 三种内置子 Agent(coder/explore/plan) | ✅ | coder=读写+bash;explore=只读;plan=只读无 shell |
| 上下文隔离 | ✅ | 子 Agent 独立 session,仅最终结果回流主上下文 |
| 并行派发 + max_concurrency | ✅ | worker 池真实上限 + 渐进投放 |
| 30 分钟超时 | ✅ | 每子 Agent 独立 AbortSignal.timeout |
| 后台运行(run_in_background) | ✅ | 早返回 task ID,task_output 可 block 等待,报告落 output_path |
| 唤回已有子 Agent(resume) | ⚠️ | 保守语义:同 id 重跑;真·会话恢复待 pi-coding-agent 暴露 resume API |
| 嵌套子 Agent(coder 再派发) | ❌ | 有意不开放——防止递归派发失控,子 Agent 工具集不含 agent/agent_swarm |
| 权限继承 | ⚠️ | 子 Agent 按创建时的工具白名单执行,不经主会话 18 级策略链逐次审批;收紧权限请用主会话策略或收窄 subagent_type |
| 指令文件层级 | ✅ | 项目级 `AGENTS.md` / `.kimi-code/AGENTS.md` → `$KIMI_CODE_HOME/AGENTS.md` → `~/.agents/AGENTS.md`,聚合生效 |
| 会话目录 wire.jsonl 持久化 | ❌ | 子 Agent 用 SessionManager.inMemory(),状态不落盘(进程内生命周期) |
| Hooks(`[[hooks]]` 生命周期钩子) | ✅ | 16 个事件全覆盖,退出码/stdout JSON 阻断语义,fail-open |
| Agent Skills(四级作用域) | ✅ | 项目/用户四级目录,目录型+扁平型,子代理与主会话双通道 |

## 安装

```bash
pi install local:~/.pi/agent/extensions/pi-muselinn-harness
```

## 命令

| 命令 | 说明 |
|------|------|
| `/swarm on\|off` | 开关 Swarm 模式 |
| `/cancel` | 取消当前任务(两步确认) |
| `/resume` | 恢复中断的 swarm |
| `/tasks` | 打开任务浏览器(快捷键 `ctrl+shift+t`) |
| `/goal <objective>` | 设置目标 |
| `/goal pause\|resume\|cancel\|replace` | 管理目标 |
| `/goal budget <n> <unit>` | 设置预算(turns/tokens/ms/s/minutes/hours) |
| `/goal queue` / `/goal add\|prioritize\|drop\|skip` | 队列操作 |
| `/plan` / `/plan on\|off\|clear` | Plan Mode 控制 |
| `/mode` | 切换权限模式(auto/yolo/manual) |
| `/swarm-status` | 查看状态 |

> `/goal` `/swarm` `/plan` `/mode` 均支持 Tab 子命令/参数补全。

## 工具

| 工具 | 说明 |
|------|------|
| `agent_swarm` | 批量并行子代理(`max_concurrency` / `run_in_background` / `output_path` / `model_map`) |
| `agent` | 单个子代理 |
| `create_goal` / `get_goal` / `update_goal` / `set_goal_budget` | 目标管理 |
| `enter_plan_mode` / `exit_plan_mode` | Plan Mode |
| `run_background` / `task_list` / `task_output` / `task_stop` | 后台任务 |
| `cron_create` / `cron_list` / `cron_delete` | 定时任务 |

## 架构

```
pi-muselinn-harness/
├── index.ts          入口(agent_swarm / agent 工具、后台 swarm runner、各模块接线)
├── state.ts          共享状态
├── completions.ts    命令参数补全(Tab 补全,prefix 过滤+空回退)
├── swarm/            Swarm 模块
│   ├── subagent.ts   子代理执行(worker 池、30min 超时、配置缓存)
│   ├── commands.ts   /swarm /cancel /resume /tasks + ctrl+shift+t
│   ├── widget.ts     TUI 组件(pi-tui Component + 指纹门控)
│   ├── task-browser.ts 三栏浏览器(状态字形/折叠/命名键位)
│   ├── task-list-utils.ts 折叠与键位路由(纯函数)
│   ├── estimator.ts  进度估算(几何平均)
│   └── helpers.ts    盲文进度条/布局(memo 缓存)
├── goal/             Goal 模块
│   ├── index.ts      GoalManager(状态机 + 3 轮阈值 + 判据门禁)
│   ├── commands.ts   /goal 命令
│   ├── tools.ts      create/get/update_goal + set_goal_budget
│   ├── budget.ts     Budget Report
│   ├── persistence.ts 持久化
│   └── queue.ts      Goal Queue
├── plan/             Plan 模块
│   ├── index.ts      PlanManager(工具白名单 + 路径守卫)
│   ├── commands.ts   /plan 命令
│   ├── tools.ts      enter/exit_plan_mode(读盘呈现)
│   └── injection.ts  Context 注入
├── permission/       Permission 模块
│   ├── index.ts      evaluate 入口(18 级策略链)
│   ├── policies.ts   各策略(destructive/敏感文件/会话批准...)
│   ├── config.ts     配置加载(mtime 缓存)+ AGENTS.md 层级解析
│   └── commands.ts   /mode 命令
├── task/             Task 模块
│   ├── index.ts      后台任务管理(50 上限/7天 stale/增量持久化)
│   └── cron.ts       Cron 定时任务(5 字段 + jitter + one-shot)
├── hooks/            Hooks 模块(Kimi Code [[hooks]] 引擎)
│   ├── config.ts     TOML 迷你解析 + 双层配置 + mtime 缓存
│   ├── executor.ts   spawn 执行 + 退出码语义 + fail-open
│   └── index.ts      HookEngine + 16 事件接线 + pi.events 镜像
├── skills/           Skills 模块(Kimi Code 四级作用域)
│   ├── frontmatter.ts YAML frontmatter 迷你解析
│   ├── scanner.ts    四级扫描 + 去重 + 缓存
│   └── index.ts      loadSkillsForCwd / resources_discover 接线
└── tests/            node 级单元测试(见下)
```

## 测试

无需模型额度的 node 级单元测试(共 168 项断言):

```bash
node tests/permission.test.mjs                    # Permission 策略链 14 项
node tests/goal.test.mjs                          # Goal 状态机 17 项
node --experimental-strip-types tests/cron.test.mjs  # Cron 子系统 16 项
node tests/hooks.test.mjs                         # Hooks 引擎 43 项
node tests/skills.test.mjs                        # Skills 扫描/解析 28 项
node tests/tui.test.mjs                           # TUI 折叠/键位/补全 50 项
```

## 依赖

- Pi >= 0.80.0
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

## 致谢

本扩展的设计和实现参考了以下开源项目，在此表示感谢：

### [Kimi Code](https://github.com/MoonshotAI/Kimi-code) (Moonshot AI)
- Agent Swarm 并发执行架构(max_concurrency worker 池、30min 超时、run_in_background)
- Goal 系统设计(GoalActor 追踪、Budget Report、blocked 3 轮阈值、Context 注入)
- Plan Mode 生命周期(enter/exit/approve/reject、ExitPlanMode 读盘)
- Permission 策略链(auto/yolo/manual、destructive 必问、AGENTS.md 优先级)
- Cron 定时任务(5 字段 + jitter + 7 天 stale + 50 上限)
- TUI 组件设计(盲文进度条、三栏任务浏览器)
- 取消/恢复机制(AbortSignal 链、UserCancellationError)

### [@narumitw/pi-goal](https://www.npmjs.com/package/@narumitw/pi-goal) (narumitw)
- Goal Queue FIFO + Auto-switch 机制
- usage_limited / budget_limited 状态设计
- Wrap-up 指令注入(预算耗尽后的行为)
- Stale Tool Blocking 设计
- Compaction 保留策略

### [pi-codex-goal](https://www.npmjs.com/package/pi-codex-goal) (fitchmultz)
- Goal 持久化方案(appendEntry + session_start 恢复)
- Goal 状态转换逻辑
- Budget 检查机制
- Recovery Machine 概念(简化版)

---

**注意**：本扩展是独立实现，未直接引用上述项目的代码。设计灵感来源于这些项目，但所有代码均为原创。

## License

MIT
