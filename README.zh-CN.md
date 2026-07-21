# pi-muselinn-harness


Kimi Code 风格的 Pi Agent 扩展 — Swarm + Goal + Plan + Permission + Task + Hooks + Skills 七模块架构，全面对齐 Kimi Code 的子系统行为。

> **维护模式（0.7.4 起）**：本扩展只接收 bug 修复与 Pi 兼容更新。新功能在 **MusePi**（Pi fork）开发 — 见 [MusePi-PLAN.md](MusePi-PLAN.md)。

### 0.7.4 新功能

- **`ask_user_question` 工具** — 原生交互式问卷对话框（编号选项，与审批流共用组件）
- **`todo_list` 工具 + 内联面板** — 会话共享 todo，带折叠策略（替代外部 rpiv-todo）
- **审批面板** — 分工具标题、数字键直选、拒绝可填理由（manual 权限档）
- **Swarm 权限门控** — 共享权限管理器，`/mode` 广播到全部子代理
- **编辑器锚定** — slash 菜单关闭后输入锚定（渲染边沿检测）
- **`toolResultTruncation`** — 超大工具结果落盘，留 preview + `output_path`
- **子代理 resume 守卫** — resume 前做所有权/空闲校验
- **`fetch_url` 工具** — 无鉴权 URL 抓取（替代外部依赖）
- **插件 manifest** — 六件套包元数据

[English](README.md) · [项目主页](https://muselinn.github.io/pi-muselinn-harness/) · [pi.dev 包目录](https://pi.dev/packages)

![闭合框编辑器,上边框嵌入工作状态](docs/assets/img/pi-boxed-editor.png)

## 功能

### Swarm 模块
- **子代理执行** — `createAgentSession()` in-process 执行
- **并发控制** — `runProgressive()` worker 池，真实 `max_concurrency` 上限 + 指数退避重试
- **30 分钟超时** — 每个子代理独立 `AbortSignal.timeout`(30min，对齐 Kimi Code)
- **run_in_background** — swarm 整体转后台任务，早返回 task ID，报告可落 `output_path`
- **智能模型路由** — 从 `ctx.modelRegistry` 自动发现，任务感知选择
- **盲文进度条** — 真实工具调用进度驱动，250ms 帧 + 状态指纹门控(未变帧零成本跳过)
- **自有 spinner** — 状态栏动画默认单宽度盲文旋转(与进度条同一设计语言，窄终端不抖动),`PI_MUSELINN_SPINNER=braille|pulse|bounce|moon` 可切换(含 Kimi 月相兼容)
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
- **审批面板** — 编号对话框，按工具定制动作标题("Run this command?" / "Apply these edits?")，数字键 1-9 直选，四种结果：Allow once / Always allow(本会话) / Deny / Deny with reason(理由回传给模型)
- **子代理门控** — swarm worker 的工具调用经过同一策略链（进程内共享管理器）:`/mode` 切换天然传播到进行中的子代理,ask 判定降级为阻断（绝不静默放行）
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
- **pi 原生七级作用域扫描** — 项目级 `.pi/skills`、`.kimi-code/skills`(Kimi 兼容)、`.agents/skills` → 用户级 `~/.pi/agent/skills`、`~/.pi/skills`、`$KIMI_CODE_HOME/skills`、`~/.agents/skills`;pi 原生目录优先，Kimi Code 目录作兼容层，按 name 去重(先到先得，冲突记 diagnostic)
- **目录型 + 扁平型** — `SKILL.md` 子目录(可带辅助文件)与单 `.md` 文件,frontmatter 全字段(name/description/type/whenToUse/disableModelInvocation/arguments,含横杠/下划线变体)
- **子代理可用** — swarm 与后台任务的子代理 session 经 resourceLoader 拿到 skills(与主会话同一批 pi 原生技能);主会话经 `resources_discover` 注入(只返回 pi 不扫的兼容目录 `.kimi-code/skills`、`~/.pi/skills` 中的 SKILL.md 文件,并按名排除 pi 原生目录已提供的技能——pi 原生目录优先,不再产生 collision 诊断)
- **零依赖 frontmatter 解析器** + mtime 目录树缓存

### TUI 模块
- **闭合框编辑器** — 移植 Kimi Code 的 `wrapWithSideBorders`:pi-tui 默认只有上下横线,后处理为 `╭╮│╰╯` 闭合框;上边框嵌入 spinner + 工作状态(Thinking/Streaming/Running tools),`plain | boxed | compact` 三种样式(pi-spark 式信息上边框为 compact),默认 boxed;模型名默认不进边框(pi 状态行已有),需要时配置 `"modelInBorder": true`
- **`/tui` 命令** — `/tui style plain|boxed|compact` 热切换编辑器样式(不重启,pi 热交换编辑器时保留文本/焦点/键位),`/tui timing` 查看渲染耗时;配置持久化到 `~/.pi/agent/muselinn-tui.json`(项目级 `.pi/muselinn-tui.json` 覆盖)
- **plan 徽标** — plan mode 激活时上边框左侧显示 `plan` 文本徽标(不染边框色,与 pi 思考模式换色零冲突)
- **性能探针** — `PI_MUSELINN_HARNESS_TUI_TIMING=1` 时统计 editor `render()` 耗时的 P50/P99;spinner 仅在工作时以 250ms 帧率驱动

> 注:曾移植 pi-spark 的 BottomFiller 伪全屏(钉底布局),因其只在短会话有视觉效果(长会话填充量恒为 0)已移除;真正的编辑器钉底需要 alternate screen,属 pi-core 范畴。

### Ask 模块(交互式提问)
- **`ask_user_question` 工具** — agent 向用户发起编号单选提问（支持多题连问）；数字键 1-9 直选，方向键/jk 导航，Esc 取消
- **共享对话框组件** — 权限审批复用同一编号组件；print/RPC 无 UI 模式下退化为文本提问，不阻塞
- **auto 模式安全** — auto 模式下 `ask_user_question` 被策略专门拒绝（防无人值守卡死）

### Todo 模块(内联任务计划)
- **`todo_list` 工具** — update(整表重写) / read / clear；模型的计划在 turn 间对用户持续可见
- **内联面板** — 编辑器上方 widget,采用 Kimi Code 的折叠策略（in_progress 全部优先，pending 取最早，保留一个最近完成位）;`ctrl+t` 展开/折叠
- **会话持久化** — 热重载不丢；新会话永远从空面板开始

### Web fetch 模块
- **`fetch_url` 工具** — 无鉴权 URL 抓取（20s 超时、5MB 流上限、跟随重定向）;HTML → 可读文本（零依赖提取器）,JSON → 美化输出，其余原样返回；默认 20k 字符上限，`max_chars` 可调

### Plugin 模块(声明式资源包)
- **`muselinn.plugin.json`** — 六件套声明式能力：`skills`(skill 目录并入发现)、`sessionStart`(会话首轮注入上下文)、`hooks`(并入 `[[hooks]]` 引擎)、`commands`(.md 文件变 slash 命令),以及 `mcpServers` / `interface`（记录并给出 skipped 诊断）
- **发现机制** — 项目 `.pi/plugins/*/` 优先于用户 `~/.pi/agent/plugins/*/`,同名先到先得；`/plugins` 查看能力与诊断

### 输出截断
- **超大工具结果落盘** — 超过 40k 字符的结果写入 `<sessionDir>/tool-results/`,上下文中只保留净化后的头尾预览 + `output_path`,附 read 分页说明（对齐 Kimi `toolResultTruncation`)

## 与 Kimi Code 的对齐情况

对照 [Kimi Code CLI 官方文档 — Agent 与子 Agent](https://www.kimi.com/code/docs/kimi-code-cli/customization/agents.html):

| 能力 | 状态 | 说明 |
|------|------|------|
| 三种内置子 Agent(coder/explore/plan) | ✅ | coder=读写+bash;explore=只读;plan=只读无 shell |
| 上下文隔离 | ✅ | 子 Agent 独立 session,仅最终结果回流主上下文 |
| 并行派发 + max_concurrency | ✅ | worker 池真实上限 + 渐进投放 |
| 30 分钟超时 | ✅ | 每子 Agent 独立 AbortSignal.timeout |
| 后台运行(run_in_background) | ✅ | 早返回 task ID,task_output 可 block 等待,报告落 output_path |
| 唤回已有子 Agent(resume) | ⚠️ | 保守语义:同 id 重跑;resume 已加守卫(有保存态+无在飞 swarm+有剩余项);真·会话恢复待 pi-coding-agent 暴露 resume API |
| 嵌套子 Agent(coder 再派发) | ❌ | 有意不开放——防止递归派发失控,子 Agent 工具集不含 agent/agent_swarm |
| 权限继承 | ✅ | worker 工具调用经过进程内共享的 18 级策略链;/mode 切换天然传播,ask 降级为阻断 |
| 指令文件层级 | ✅ | 项目级 `AGENTS.md` / `.kimi-code/AGENTS.md` → `$KIMI_CODE_HOME/AGENTS.md` → `~/.agents/AGENTS.md`,聚合生效 |
| 会话目录 wire.jsonl 持久化 | ❌ | 子 Agent 用 SessionManager.inMemory(),状态不落盘(进程内生命周期) |
| Hooks(`[[hooks]]` 生命周期钩子) | ✅ | 16 个事件全覆盖,退出码/stdout JSON 阻断语义,fail-open |
| Agent Skills(四级作用域) | ✅+ | 完整覆盖 Kimi 四级目录,并扩展为 pi 原生七级(`.pi/skills`、`~/.pi/agent/skills` 等优先,Kimi 目录兼容);目录型+扁平型,子代理与主会话双通道 |

## 安装

```bash
pi install npm:pi-muselinn-harness
```

也可以从 git 或本地源码安装：

```bash
pi install git:github.com/MuseLinn/pi-muselinn-harness
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
| `/tui` | 切换编辑器样式(plain/boxed/compact) |
| `/plugins` | 查看已加载插件及能力 |
| `ctrl+t` | 展开/折叠 todo 面板 |
| `/swarm-status` | 查看状态 |

> `/goal` `/swarm` `/plan` `/mode` `/tui` 均支持 Tab 子命令/参数补全。

## 工具

| 工具 | 说明 |
|------|------|
| `agent_swarm` | 批量并行子代理(`max_concurrency` / `run_in_background` / `output_path` / `model_map`) |
| `agent` | 单个子代理 |
| `create_goal` / `get_goal` / `update_goal` / `set_goal_budget` | 目标管理 |
| `enter_plan_mode` / `exit_plan_mode` | Plan Mode |
| `ask_user_question` | 向用户发起编号单选提问 |
| `todo_list` | 模型驱动的任务计划（内联面板） |
| `fetch_url` | 无鉴权 URL 抓取（内容感知提取） |
| `run_background` / `task_list` / `task_output` / `task_stop` | 后台任务 |
| `cron_create` / `cron_list` / `cron_delete` | 定时任务 |

## 架构

core/adapter 分层:`packages/core/` 是**零 pi import** 的纯逻辑
（未来的 `@muselinn/core` 包 / MusePi fork 地基）;仓库根部是 pi
适配层（入口、pi-tui 组件、工具注册）。

```
pi-muselinn-harness/
├── index.ts               入口(agent_swarm / agent 工具、后台 swarm runner、各模块接线)
├── state.ts               共享状态
├── packages/core/         @muselinn/core — 纯逻辑,零 host import
│   ├── ports.ts           host 契约(PersistencePort、ScopeDirs)
│   ├── text-utils.ts      visibleWidth 等
│   ├── shell-output.ts    控制序列净化器
│   ├── truncation/        超大工具结果落盘(纯函数)
│   ├── webfetch/          HTML→文本 / JSON 提取(纯函数)
│   ├── completions.ts     命令参数补全(Tab 补全)
│   ├── ask/               提问规格 + 答案格式化(纯函数)
│   ├── todo/              todo 模型 + Kimi 折叠策略(纯函数)
│   ├── plugin/            muselinn.plugin.json manifest 解析/发现
│   ├── goal/              Goal 模块(状态机 + 预算 + 队列 + 持久化)
│   ├── plan/              Plan 模块(工具白名单 + 路径守卫 + 注入)
│   ├── permission/        Permission 模块(18 级策略链 + 审批契约)
│   ├── hooks/             Hooks 模块(TOML 迷你解析 + 执行器 + 16 事件)
│   ├── skills/            Skills 模块(frontmatter + 七级扫描)
│   ├── swarm/             swarm 纯逻辑半
│   │   ├── types.ts       状态/常量(+ goal re-export)
│   │   ├── helpers.ts     盲文条/布局/spinner(memo 缓存)
│   │   ├── estimator.ts   进度估算(几何平均)
│   │   ├── widget-lines.ts 盲文网格行构建(纯函数)
│   │   ├── wrap-tools.ts  权限门控包装(纯函数)
│   │   ├── resume-guard.ts resume 所有权/空闲校验(纯函数)
│   │   ├── report.ts      swarm 报告格式化
│   │   └── task-list-utils.ts 折叠与键位路由
│   ├── task/              cron + 任务持久化状态(纯函数)
│   └── tui/               box/config/parse/switch/timing(纯 chrome 件)
├── swarm/                 适配层:子代理执行、/swarm 命令、
│                          SwarmWidgetComponent、三栏任务浏览器
├── task/                  适配层:后台任务管理(会话 spawn)
├── tui/                   适配层:MuselinnEditor + 事件接线
├── ask/                   适配层:提问对话框 + ask_user_question 工具
├── todo/                  适配层:todo_list 工具 + 内联面板
├── webfetch/              适配层:fetch_url 工具
├── plugin/                适配层:插件加载器 + /plugins 命令
└── tests/                 node 级单元测试(见下)
```

## 测试

无需模型额度的 node 级单元测试(共 362 项断言):

```bash
node tests/permission.test.mjs                    # Permission 策略链 + 子代理门控 19 项
node tests/goal.test.mjs                          # Goal 状态机 17 项
node tests/cron.test.mjs                          # Cron 子系统 16 项
node tests/hooks.test.mjs                         # Hooks 引擎 43 项
node tests/skills.test.mjs                        # Skills 扫描/解析/作用域/discover 38 项
node tests/tui.test.mjs                           # TUI 折叠/键位/补全/spinner 56 项
node tests/tui-box.test.mjs                       # TUI 闭合框/配置/探针/切换 61 项
node tests/ask.test.mjs                           # ask 规格/数字键/答案/审批标题 24 项
node tests/todo.test.mjs                          # todo 模型 + 折叠策略 19 项
node tests/shell-output.test.mjs                  # 输出净化器 21 项
node tests/truncation.test.mjs                    # 结果落盘截断 13 项
node tests/resume-guard.test.mjs                  # swarm resume 守卫 6 项
node tests/webfetch.test.mjs                      # web 内容提取 12 项
node tests/plugin.test.mjs                        # 插件 manifest/发现 17 项
```

## 下一步(Roadmap)

- **MusePi** — fork 路线:`@muselinn/core` 已完成抽取（Phase 1 完成,`packages/core/` 零 pi import）;下一步是自研增量渲染器替换 pi-tui + pi extension API 兼容层。见 `MusePi-PLAN.md` 与 `RESEARCH-kimi-code.md`
- **i18n** — harness 界面文案与通知双语化(文档已拆分中英;项目页已有 EN/中 切换)
- **公式渲染转正** — 待压缩路径的上下文安全性确认后,合入 `feature/math-renderer`
- **clustered diff 预览** — edit/write 审批消息中的 ±3 行聚簇 diff（P1 批次延迟项）
- **真全屏** — container swap 全屏（kimi 任务浏览器模式）,不用 alt screen,保留终端 scrollback

## 依赖

- Pi >= 0.80.0
- `@earendil-works/pi-coding-agent`
- `@earendil-works/pi-ai`
- `@earendil-works/pi-tui`
- `typebox`

**无需伴随扩展** — 单独安装即可满血使用。以下可选扩展能提升体验：

- [`@juicesharp/rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question) — 让 swarm 的模型路由交互式问你而不是自动决定(工具描述里引用了 `ask_user_question`;没装则模型自行选择)
- [`@juicesharp/rpiv-todo`](https://www.npmjs.com/package/@juicesharp/rpiv-todo) — 实时 todo 浮层;任务浏览器借鉴了它的状态字形/溢出语义,但不依赖它

## 致谢

本扩展的设计和实现参考了以下开源项目，在此表示感谢：

### [Kimi Code](https://github.com/MoonshotAI/Kimi-code) (Moonshot AI)
- Agent Swarm 并发执行架构(max_concurrency worker 池、30min 超时、run_in_background)
- Goal 系统设计(GoalActor 追踪、Budget Report、blocked 3 轮阈值、Context 注入)
- Plan Mode 生命周期(enter/exit/approve/reject、ExitPlanMode 读盘)
- Permission 策略链(auto/yolo/manual、destructive 必问、AGENTS.md 优先级)
- Cron 定时任务(5 字段 + jitter + 7 天 stale + 50 上限)
- TUI 组件设计(盲文进度条、三栏任务浏览器、`wrapWithSideBorders` 闭合框编辑器)
- 取消/恢复机制(AbortSignal 链、UserCancellationError)

### [pi-spark](https://github.com/zlliang/pi-spark) (zlliang)
- 编辑器上边框信息位设计(spinner + 工作状态 + 模型名嵌入边框)
- 组件替换式 TUI 改造路径(`setEditorComponent` / `setFooter` / `setWidget`)

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

**注意**：本扩展大部分为独立实现。例外：`tui/box.ts` 的 `wrapWithSideBorders` 移植自 Kimi Code(MIT),已保留出处注释并按 MIT 条款使用。

## License

MIT
