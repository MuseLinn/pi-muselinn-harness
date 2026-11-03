# pi-muselinn-harness：为 pi 加上并行代理与执行管控

一次安装，为 [Pi coding agent](https://pi.dev) 加上并发子代理、目标预算、计划审批和工具权限。

让编码代理处理大任务时，你既要安排并行排查，又要避免各路输出塞满主会话，还得盯着工具会不会直接改文件。这个编排层把工作分到独立的子代理会话，再汇总结果；用预算和队列跟踪目标，并在执行过程中加入计划审批与权限检查。

[![test](https://github.com/MuseLinn/pi-muselinn-harness/actions/workflows/test.yml/badge.svg)](https://github.com/MuseLinn/pi-muselinn-harness/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/pi-muselinn-harness.svg)](https://www.npmjs.com/package/pi-muselinn-harness)
[![downloads](https://img.shields.io/npm/dt/pi-muselinn-harness.svg)](https://www.npmjs.com/package/pi-muselinn-harness)
[![stars](https://img.shields.io/github/stars/MuseLinn/pi-muselinn-harness.svg)](https://github.com/MuseLinn/pi-muselinn-harness/stargazers)
[![license](https://img.shields.io/npm/l/pi-muselinn-harness.svg)](https://github.com/MuseLinn/pi-muselinn-harness/blob/main/LICENSE)

[English](README.md)

## 30 秒能看到什么

**（演示 GIF 待录制 / demo GIF pending）** — 预定路径：`docs/demo/swarm.gif`；[录制指南](docs/demo/README.md)。
<!-- 录制并检查后，将占位替换为 docs/demo/swarm.gif 图片。 -->

*演示图注：两个 explore 子代理并行梳理入口与测试，Swarm 面板实时显示进度，最后汇总为一份简短结论。*

1. **安装**（需已有 pi 环境）：

   ```bash
   pi install npm:pi-muselinn-harness
   ```

2. **在项目目录启动新的交互会话**（运行 `pi`），逐条输入以下斜杠命令；编辑器会立即切换样式，不需要调用模型：

   ```text
   /tui style compact
   /tui style boxed
   /swarm on
   ```

3. **试试并行工作。** 在 pi 中配置好模型后，将下面这段话作为普通提示发送：

   ```text
   使用 agent_swarm，启动两个 explore 子代理，max_concurrency=2：一个梳理当前项目的入口，另一个梳理测试。不要修改文件。最后汇总成一份简短结论。
   ```

你应该看到编辑器样式切换、状态栏出现 `swarm`；模型调用 `agent_swarm` 后，实时面板会显示两个任务的进度，随后返回汇总结论。模型响应和权限审批可能超过 30 秒；切换样式无需等待这些步骤。

## 能力一览

| 能力 | 能做什么 |
|---|---|
| Swarm | 在独立会话中并发运行子代理，限制并发数并实时显示进度。 |
| 目标 | 跟踪目标、预算、完成判据和优先级队列。 |
| 计划模式 | 执行前审批计划；write/edit 仅能修改计划文件，bash 仍走权限规则。 |
| 权限 | 通过 18 级策略链检查工具调用，拦截破坏性命令与敏感文件访问。 |
| 暂停与转向 | 在工具边界暂停主代理和 swarm 子代理，向运行中的子代理追加指令。 |
| 后台与定时任务 | 后台运行代理、定时发送提示，并持久化任务记录。 |
| 提问与待办 | 收集结构化回答，用内联面板展示分阶段计划与提醒。 |
| Hooks | 在 16 个生命周期事件运行命令，在支持的门禁处阻断执行。 |
| Skills 与插件 | 扫描项目及用户目录的技能，加载声明式资源包。 |
| TUI | 提供 Kimi Code 风格的闭合框编辑器、实时任务浏览器与样式切换。 |
| 上下文与联网 | 将超大工具输出转存文件，抓取 URL 的可读内容。 |

## 安装细节

已验证兼容 pi 0.81.x–0.83.x（macOS / Ubuntu / Windows）· Node 24/26 · CI 矩阵覆盖 macOS + Ubuntu + Windows。

也可以从 Git 安装：

```bash
pi install git:github.com/MuseLinn/pi-muselinn-harness
```

开箱即用，**无需伴随扩展**。工具可由模型调用，斜杠命令支持 Tab 补全。操作方式见[命令](#命令)，配置细节见[功能](#功能)。

![闭合框编辑器（上边框嵌入流式状态）](https://muselinn.github.io/pi-muselinn-harness/assets/img/pi-boxed-editor.png)

> **从 ≤ 0.7.4 升级？** 请移除旧的伴随扩展——它们与内置工具重名冲突
> （pi 会拒绝启动）：
> ```bash
> pi remove npm:@juicesharp/rpiv-ask-user-question
> pi remove npm:rpiv-todo
> ```

## 功能

### Swarm 模块
- **子代理执行** — `createAgentSession()` in-process 执行，`coder` / `explore` / `plan` 三种类型
- **真实并发控制** — `runProgressive()` worker 池，真实 `max_concurrency` 上限 + 指数退避重试
- **30 分钟超时** — 每个子代理独立 `AbortSignal.timeout`（对齐 Kimi Code）
- **run_in_background** — swarm 整体转后台任务，早返回 task ID，报告可落 `output_path`
- **智能模型路由** — 从 `ctx.modelRegistry` 自动发现，任务感知选择
- **盲文进度条** — 真实工具调用进度驱动，250ms 帧 + 状态指纹门控（未变帧零成本跳过）
- **自有 spinner** — 状态栏动画默认单宽度盲文旋转，`PI_MUSELINN_SPINNER=braille|pulse|bounce|moon` 可切换（含 Kimi 月相兼容）
- **自适应布局** — pi-tui Component 协议渲染，状态栏宽度随终端自适应（10–60）
- **三栏任务浏览器** — 状态字形（○ pending / ◐ running / ✓ done / ✗ failed / ▲ aborted）+ 完成行删除线、溢出折叠（`+N more`，优先保留 running）、命名键位路由、`ctrl+shift+t` 快捷键
- **取消/恢复** — UserCancellationError + AbortSignal 链，`/cancel` 两步确认

### Pause & Steer（冻结、检视、转向）
- **`/pause` 全屏冻结** — 主代理与所有 swarm 子代理在下一个安全边界挂起（工具门卫）：进行中的调用跑完，什么都不中止，释放后各自从挂起点继续。全屏遮罩——主题色暂停符号、实时计时——esc/enter/space/ctrl+c 释放，并在会话流中留下状态行（`已恢复（暂停 13s）— 代理继续运行`）；暂停落在工具边界时遮罩带 `<tool_call>` 标签
- **Transcript 落盘** — 每个子代理的对话写入 `<sessionDir>/agents/<taskId>/wire.jsonl`（user / assistant → tool-call 行，含时间戳、stop reason、usage；**刻意不落工具参数**）。任务浏览器（`/tasks` / `ctrl+shift+t`）按 `c` 键看对话视图，或直接用 Read 读文件
- **`/steer <taskId> <message>`** — 向运行中的子代理注入消息（swarm 会话或后台任务；task id 支持 Tab 补全）。代理循环在当前工具调用完成后投递——无需取消/重启
- **安全边界** — 取消单个挂起的运行（AbortSignal）只释放该次等待，绝不动门禁；后台任务（`run_background`）不冻结（其工具调用不经 harness 门卫），但同样获得 transcript 与 steer
- **主题色遮罩** — 图标/标题/正文/提示全部使用当前主题的 `accent`/`text`/`muted`/`dim`，终端背景即遮罩底色；块字符（█ / ⏸）按单宽计量，暂停符号与下方文字精确对齐居中

### Goal 模块
- **Goal 生命周期** — active / paused / blocked / complete / usage_limited / budget_limited
- **Active Guard** — 已有 active 目标时 `create_goal` 拒绝静默覆盖，需 `replace=true` 或 `/goal replace`
- **Blocked 3 轮阈值** — 同一原因连续 3 次 block 才真正进入 blocked
- **完成判据门禁** — 声明了 completionCriterion 时，需在同一次 `update_goal` 调用中传 `verified=true` 才能 complete（已写入工具描述）
- **Budget 三重检测** — tokenBudget + turnBudget + wallClockBudgetMs，`set_goal_budget` 支持 turns/tokens/ms/s/min/hours
- **Goal Queue** — FIFO + high/normal 优先级 + auto-switch + prioritize/drop/skip
- **持久化** — appendEntry + session_start 恢复；计数按 goalId **单调合并**（max），过期 entry 不会把轮次/token 拉回过去；`clear()` 写入墓碑 entry，完成的目标不会复活
- **Context 注入** — `<untrusted_objective>` 标签注入 system prompt
- **Recovery** — compaction 保留 + context overflow 检测 + 429 检测

### Plan 模块
- **Plan Mode** — LLM 先探索代码库、写计划、审批后再执行
- **Kimi Code 权限模型** — plan mode 不拦截 bash，bash 走正常的 permission mode（auto/yolo/manual）。只拦截 Write/Edit（非 plan 文件）、TaskStop、CronCreate、CronDelete
- **Plan 文件路径匹配** — 精确路径、`local://` scheme 文件名、解析后绝对路径在 `sessionDir/plans/` 下，三种方式均支持
- **ExitPlanMode 读盘** — 呈现时读取 plan 文件真实内容，与 LLM 写盘保持一致
- **Revise 保留 plan** — 评审选 Revise 或取消会以同一个 plan 对象（id/路径/内容）重新进入 plan 模式，不困住用户、不丢工作；评审超时 600s
- **恢复校验** — 无内容且磁盘无文件的过期 active-plan entry 会停用 plan 模式，而不是静默困住会话
- **Context 注入** — 注入 plan 到 system prompt

### Permission 模块
- **18 级策略链** — auto / yolo / manual 三模式，安全策略（destructive、敏感文件）优先于模式短路
- **Destructive 检测** — `rm -rf` / `git push --force` / `drop table` / `git reset --hard` 等正则识别，每次必问，不被会话批准短路
- **敏感文件守卫** — `.env` / `id_rsa` / `*.key` 等读写拦截，auto 模式下也不放行
- **会话批准指纹** — 按 sessionId + 输入指纹记忆批准，不蜕变为"永久许可"
- **审批面板** — 编号对话框，按工具定制动作标题，数字键 1-9 直选，四种结果：Allow once / Always allow（本会话）/ Deny / Deny with reason（理由回传给模型）。在 RPC 宿主（obsidian-pi 等）中，同样的四个选择走扩展 UI 协议（`select` / `input` / `confirm`）呈现，不再静默拒绝
- **子代理门控** — swarm worker 的工具调用经过同一策略链（进程内共享管理器）：`/mode` 切换天然传播到进行中的子代理，ask 判定降级为阻断（绝不静默放行）
- **AGENTS.md 指令** — 项目级（最近的 `AGENTS.md` 或 `.kimi-code/AGENTS.md`）→ 全局 `$KIMI_CODE_HOME/AGENTS.md` → 跨工具 `~/.agents/AGENTS.md`，聚合生效；`destructive-ask-always` 可将 ask 升级为 deny
- **配置缓存** — 权限配置按文件 mtime 缓存，变更即时生效

### Task 模块（后台任务 + 定时任务）
- **run_background** — 子代理后台执行，立即返回 task ID；`output_path` 把完整输出落盘供 Read 分页
- **30 分钟超时** — 后台任务超时自动失败（`stopReason=timeout_30min`）
- **task_list / task_output / task_stop** — `active_only` 过滤、`block+timeout` 等待完成、`offset/limit` 分页
- **50 任务上限** + **7 天 stale 清理** + 重启孤儿任务降级 `process_restart`
- **增量持久化** — 单任务变更只 append 单条 entry，restore 兼容旧快照
- **Cron 定时任务** — 5 字段 cron（本地时区）+ 确定性 jitter（周期 10%，上限 15min）+ recurring/one-shot + 50 上限 + 7 天 stale 自动删

### Hooks 模块
- **Kimi Code 对齐的 `[[hooks]]` 引擎** — 读取 `$KIMI_CODE_HOME/config.toml`（默认 `~/.kimi-code/config.toml`）+ 项目级 `.kimi-code/config.toml`，支持 event/matcher/command/timeout 四字段
- **全事件覆盖** — UserPromptSubmit / PreToolUse / Stop（可阻断）+ PostToolUse / PostToolUseFailure / PermissionRequest / PermissionResult / SessionStart / SessionEnd / SubagentStart / SubagentStop / StopFailure / Interrupt / PreCompact / PostCompact / Notification
- **退出码语义** — `0` 放行（stdout 附加上下文）、`2` 阻断（stderr 为原因）、其他/超时/崩溃 fail-open；支持 stdout JSON `permissionDecision: deny`
- **内置 TOML 迷你解析器** — 零依赖，非法规则 warn 跳过不炸扩展；mtime 缓存热加载
- **安全网** — Stop 连续阻断 3 次自动停止注入（防死循环）；所有触发镜像到 `pi.events` 供其他扩展订阅

### Skills 模块
- **pi 原生七级作用域扫描** — 项目级 `.pi/skills`、`.kimi-code/skills`（Kimi 兼容）、`.agents/skills` → 用户级 `~/.pi/agent/skills`、`~/.pi/skills`、`$KIMI_CODE_HOME/skills`、`~/.agents/skills`；pi 原生目录优先，Kimi 目录作兼容层，按 name 去重
- **目录型 + 扁平型** — `SKILL.md` 子目录（可带辅助文件）与单 `.md` 文件，frontmatter 全字段（name/description/type/whenToUse/disableModelInvocation/arguments，含横杠/下划线变体）
- **子代理可用** — swarm 与后台任务的子代理 session 经 resourceLoader 拿到 skills；主会话经 `resources_discover` 注入（只返回 pi 不扫的兼容目录，按名排除 pi 原生已提供的技能——零冲突）
- **零依赖 frontmatter 解析器** + mtime 目录树缓存

### TUI 模块
- **闭合框编辑器** — 移植 Kimi Code 的 `wrapWithSideBorders`：pi-tui 默认只有上下横线，后处理为 `╭╮│╰╯` 闭合框；上边框嵌入 spinner + 工作状态（Thinking/Streaming/Running tools），`plain | boxed | compact` 三种样式，默认 boxed；模型名需要时配置 `"modelInBorder": true`

  首个内容行带提示符（`│❯ text │`），padding 最低 2，边框永不触碰文本/光标。
- **`/tui` 命令** — `/tui style plain|boxed|compact` 热切换编辑器样式（不重启，保留文本/焦点/键位），`/tui timing` 查看渲染耗时；配置持久化到 `~/.pi/agent/muselinn-tui.json`（项目级 `.pi/` 覆盖）
- **plan 徽标** — plan mode 激活时上边框显示 `plan` 文本徽标（不染边框色，与 pi 思考模式换色零冲突）
- **性能探针** — `PI_MUSELINN_HARNESS_TUI_TIMING=1` 统计 editor `render()` 的 P50/P99；spinner 仅在工作时以 250ms 帧率驱动
- **Shimmer 工作消息（OMP 风格）** — 编辑器边框里的工作状态文字带墙钟驱动的光带扫描（`classic` 余弦光带或 `kitt` K.I.T.T. 扫描灯）；亮头处 accent+bold 高亮，浅色文字在动画中也清晰。默认 `low: dim / mid: muted / high: accent`；`/tui shimmer <classic|kitt|disabled>` 热切换，配置持久化
- **稳定的动画帧率** — keep-alive 使用固定 200ms 静默门（≈10fps 上限），动画节奏恒定；流式时复用 pi 自然渲染零额外开销，agent 停滞时最多每秒 ~10 次全树渲染（大会话也可承受）。曾尝试按渲染延迟自适应阈值，因延迟噪声导致帧率抖动而放弃。

> 注：曾移植 pi-spark 的 BottomFiller 伪全屏，因其只在短会话有视觉效果已移除；真正的编辑器钉底需要 alternate screen，属 pi-core 范畴。

### Ask 模块（交互式提问）
- **`ask_user_question` 工具** — agent 一次发起 1-4 个结构化提问，共用一个标签页对话框：短标签页（`1/3 · header`，←/→/Tab 切换）、编号选项可带描述次行、`multi_select` 复选（空格切换、Enter 确认）、每题自动附带自由文本 **Other** 选项；数字键 1-9 直选，方向键/jk 导航，Esc 取消
- **默认健壮** — 超长选项列表在有界窗口内滚动，重复答案自动去重，后台任务也能发起提问而不卡死 UI
- **预览、备注、Chat 行** — 选项可携带 Markdown **预览**（宽终端双栏并排，窄终端堆叠）；`n` 键给选项附加**备注**；**Chat about this** 行以 `chat` 结果结束对话框，让用户先讨论再回答
- **共享对话框组件** — 权限审批复用同一组件（单选、无 Other）；print 模式下退化为文本提问，不阻塞；RPC 模式下权限审批回退到 `select`/`confirm`/`input`
- **结果回传** — 按题回传答案（多选为数组）；跳过的题与 Esc 取消区分上报
- **auto 模式安全** — auto 模式下 `ask_user_question` 被策略专门拒绝（防无人值守卡死）

### Todo 模块（内联任务计划）
- **内联面板** — 编辑器上方 widget，罗马数字阶段树（`Ⅰ. Scanner · 2/4`），`/todo toggle` 展开/折叠；完成的任务在 `PI_MUSELINN_TODO_CLEAR_DELAY` 秒后自动清除（默认 60，`0`=立即，`-1`=手动）—— 完成的计划自动淡出，不再残留
- **`/todo` 命令** — 完整 oh-my-pi 阶段模型：`init` / `start` / `done` / `drop` / `rm` / `append` / `export` / `import` / `copy` / `edit` / `add_notes` / `update_details`，裸 `/todo` 打印 Markdown
- **`todo_list` 工具** — 模型驱动的任务管理，同一套操作
- **提醒系统** — agent 停下时未完成 todo 以 `<system-reminder>` 注入下一轮（最多 3 次，防抖）
- **子代理匹配** — 与 swarm 子代理描述匹配的待办任务高亮 `◔` spinner
- **Markdown 双向导出** — `/todo export/import` 跨会话持久化与分享
- **备注** — `add_notes` / `update_details` 逐任务笔记
- **阶段计数** — widget 头部显示 `N active · M pending · K done`
- **会话持久化** — 热重载与重启不丢

### Web fetch 模块
- **`fetch_url` 工具** — 无鉴权 URL 抓取（20s 超时、5MB 流上限、跟随重定向）；HTML → 可读文本（零依赖提取器）、JSON → 美化输出、其余原样返回；默认 20k 字符上限，`max_chars` 可调
- **完整联网能力：[pi-web-access](https://pi.dev/packages/pi-web-access)** — 推荐搭配的 `web_search` / `fetch_content` 扩展（多提供商搜索、GitHub 仓库克隆、PDF / YouTube / 本地视频理解）。其 `web_search` 与 `fetch_content` 已在权限系统的只读豁免名单中——所有模式（含 plan 模式）自动放行，不会打断审批弹窗。安装：`pi install npm:pi-web-access`

### Plugin 模块（声明式资源包）
- **`muselinn.plugin.json`** — 六件套声明式能力：`skills`（skill 目录并入发现）、`sessionStart`（会话首轮注入上下文）、`hooks`（并入 `[[hooks]]` 引擎）、`commands`（.md 文件变 slash 命令），以及 `mcpServers` / `interface`（记录并给出 skipped 诊断）
- **发现机制** — 项目 `.pi/plugins/*/` 优先于用户 `~/.pi/agent/plugins/*/`，同名先到先得；`/plugins` 查看能力与诊断

### 输出截断
- **超大工具结果落盘** — 超过截断阈值的结果写入 `<sessionDir>/tool-results/`，上下文中只保留净化后的头尾预览 + `output_path`，附 read 分页说明（对齐 Kimi `toolResultTruncation`）
- **窗口感知阈值** — 阈值随当前模型上下文窗口缩放（`max(40k, 窗口 × 4 字符/token)`，上限 800k 字符 ≈ 200k token），1M 上下文的模型可保留远多输出；`PI_TRUNCATION_THRESHOLD` 可显式覆盖

## 命令

| 命令 | 说明 |
|------|------|
| `/swarm on\|off` | 开关 Swarm 模式 |
| `/pause` | 冻结所有代理到下一个安全边界（esc/enter/space/ctrl+c 恢复） |
| `/steer <taskId> <message>` | 向运行中的子代理发送消息 |
| `/cancel` | 取消当前任务（两步确认） |
| `/swarm-resume` | 恢复中断的 swarm |
| `/tasks` | 打开任务浏览器（快捷键 `ctrl+shift+t`） |
| `/goal <objective>` | 设置目标 |
| `/todo` | 任务计划（阶段模型）；子命令：`start` `done` `drop` `export` `import` `copy` `edit` `toggle` |
| `/todo toggle` | 展开/折叠 todo 面板（替代原 `alt+t`） |
| `/plugins` | 查看已加载插件及能力 |
| `/swarm-status` | 查看目标状态与预算提示；Swarm 开关及恢复状态用 `/swarm status` |
| `/plan` | 开关计划模式（也支持 `on`、`off`、`clear`） |
| `/mode auto\|yolo\|manual` | 切换权限模式 |
| `/tui style plain\|boxed\|compact` | 切换编辑器样式 |

> `/goal` `/swarm` `/plan` `/mode` `/tui` 均支持 Tab 子命令/参数补全。

## 工具

| 工具 | 说明 |
|------|------|
| `agent_swarm` | 批量并行子代理（`max_concurrency` / `run_in_background` / `output_path` / `model_map`） |
| `agent` | 单个子代理 |
| `create_goal` / `get_goal` / `update_goal` / `set_goal_budget` | 目标管理 |
| `enter_plan_mode` / `exit_plan_mode` | Plan Mode |
| `ask_user_question` | 标签页结构化提问（多选、Other 自由文本） |
| `todo_list` | 模型驱动的任务计划（内联面板） |
| `fetch_url` | 无鉴权 URL 抓取（内容感知提取） |
| `run_background` / `task_list` / `task_output` / `task_stop` | 后台任务 |
| `cron_create` / `cron_list` / `cron_delete` | 定时任务 |

## 与 Kimi Code 的对齐情况

对照 [Kimi Code CLI 官方文档 — Agent 与子 Agent](https://www.kimi.com/code/docs/kimi-code-cli/customization/agents.html):

| 能力 | 状态 | 说明 |
|------|------|------|
| 三种内置子 Agent（coder/explore/plan） | ✅ | coder=读写+bash；explore=只读；plan=只读无 shell |
| 上下文隔离 | ✅ | 子 Agent 独立 session，仅最终结果回流主上下文 |
| 并行派发 + max_concurrency | ✅ | worker 池真实上限 + 渐进投放 |
| 30 分钟超时 | ✅ | 每子 Agent 独立 AbortSignal.timeout |
| 后台运行（run_in_background） | ✅ | 早返回 task ID，task_output 可 block 等待，报告落 output_path |
| 唤回已有子 Agent（resume） | ⚠️ | 保守语义：同 id 重跑；resume 已加守卫；真·会话恢复待 pi-coding-agent 暴露 API |
| 嵌套子 Agent（coder 再派发） | ❌ | 有意不开放——防止递归派发失控，子 Agent 工具集不含 agent/agent_swarm |
| 权限继承 | ✅ | worker 工具调用经过进程内共享的 18 级策略链；`/mode` 切换天然传播，ask 降级为阻断 |
| 指令文件层级 | ✅ | 项目级 `AGENTS.md` / `.kimi-code/AGENTS.md` → `$KIMI_CODE_HOME/AGENTS.md` → `~/.agents/AGENTS.md`，聚合生效 |
| 会话目录 wire.jsonl 持久化 | ⚠️ | 每个子代理 transcript 落盘（`agents/<id>/wire.jsonl`，user/assistant/tool-call，不落工具参数）+ 对话查看器；完整会话恢复待 pi-coding-agent API |
| Hooks（`[[hooks]]` 生命周期钩子） | ✅ | 16 个事件全覆盖，退出码/stdout JSON 阻断语义，fail-open |
| Agent Skills（四级作用域） | ✅+ | 完整覆盖 Kimi 四级目录，并扩展为 pi 原生七级；目录型+扁平型，子代理与主会话双通道 |

## 架构

core/adapter 分层：`packages/core/` 是**零 pi import** 的纯逻辑；
仓库根部是 pi 适配层（入口、pi-tui 组件、工具注册）。

```
pi-muselinn-harness/
├── index.ts               入口（agent_swarm / agent 工具、后台 swarm runner、模块接线）
├── state.ts               共享状态
├── packages/core/         @muselinn/core — 纯逻辑，零 host import
│   ├── ports.ts           host 契约（PersistencePort、ScopeDirs）
│   ├── text-utils.ts      visibleWidth 等
│   ├── shell-output.ts    控制序列净化器
│   ├── truncation/        超大工具结果落盘（纯函数）
│   ├── webfetch/          HTML→文本 / JSON 提取（纯函数）
│   ├── completions.ts     命令参数补全（Tab 补全）
│   ├── ask/               提问规格 + 答案格式化（纯函数）
│   ├── todo/              todo 模型 + Kimi 折叠策略（纯函数）
│   ├── plugin/            muselinn.plugin.json manifest 解析/发现
│   ├── goal/              Goal 模块（状态机 + 预算 + 队列 + 持久化）
│   ├── plan/              Plan 模块（工具白名单 + 路径守卫 + 注入）
│   ├── permission/        Permission 模块（18 级策略链 + 审批契约）
│   ├── pause/             暂停门禁 + 全屏遮罩布局（纯函数，主题可注入）
│   ├── hooks/             Hooks 模块（TOML 迷你解析 + 执行器 + 16 事件）
│   ├── skills/            Skills 模块（frontmatter + 七级扫描）
│   ├── swarm/             swarm 纯逻辑半
│   │   ├── types.ts       状态/常量（+ goal re-export）
│   │   ├── helpers.ts     盲文条/布局/spinner（memo 缓存）
│   │   ├── estimator.ts   进度估算（几何平均）
│   │   ├── widget-lines.ts 盲文网格行构建（纯函数）
│   │   ├── wrap-tools.ts  权限门控包装（纯函数）
│   │   ├── resume-guard.ts resume 所有权/空闲校验（纯函数）
│   │   ├── report.ts      swarm 报告格式化
│   │   └── task-list-utils.ts 折叠与键位路由
│   ├── task/              cron + 任务持久化状态（纯函数）
│   └── tui/               box/config/parse/switch/timing（纯 chrome 件）
├── swarm/                 适配层：子代理执行、/swarm 命令、
│                          SwarmWidgetComponent、三栏任务浏览器
├── pause/                 适配层：/pause 遮罩组件、/steer 命令
├── task/                  适配层：后台任务管理（会话 spawn）
├── tui/                   适配层：MuselinnEditor + 事件接线
├── ask/                   适配层：提问对话框 + ask_user_question 工具
├── todo/                  适配层：todo_list 工具 + 内联面板
├── webfetch/              适配层：fetch_url 工具
├── plugin/                适配层：插件加载器 + /plugins 命令
└── tests/                 node 级单元测试（见下）
```

## 测试

无需模型额度的 node 级单元测试（29 个套件，830+ 项断言）：

```bash
npm test                                        # 全部套件（node tests/run-all.mjs）
npm run typecheck                               # 全包 tsc 类型检查（strict, es2024）
```

或逐个运行：

```bash
node tests/musepi-config.test.mjs                 # MusePi 配置兼容 — 9
node tests/permission.test.mjs                    # Permission 策略链 + 子代理门控 26 项
node tests/goal.test.mjs                          # Goal 状态机 + 单调恢复 32 项
node tests/plan.test.mjs                          # Plan 模式往返 + 恢复校验 42 项
node tests/task.test.mjs                          # Task 恢复/列表/输出/阻塞 + loader runtime 16 项
node tests/cron.test.mjs                          # Cron 子系统 16 项
node tests/hooks.test.mjs                         # Hooks 引擎 43 项
node tests/skills.test.mjs                        # Skills 扫描/解析/作用域/discover 38 项
node tests/tui.test.mjs                           # TUI 折叠/键位/补全/spinner 63 项
node tests/tui-box.test.mjs                       # TUI 闭合框/配置/探针/切换 63 项
node tests/tui-adapter.test.mjs                   # TUI 适配器 working-state 渲染路径 4 项
node tests/agent-file.test.mjs                   # agent 文件发现/解析 — 11
node tests/agent-lifecycle.test.mjs               # agent 生命周期事件 — 6
node tests/ask.test.mjs                           # ask 规格/对话框/答案/审批标题 123 项
node tests/ask-concurrency.test.mjs              # 并发提问对话框处理
node tests/tool-policy.test.mjs                  # 工具策略门控 — 13
node tests/pause-gate.test.mjs                    # 暂停门禁 + 全屏渲染 — 55
node tests/transcript.test.mjs                     # transcript wire.jsonl 落盘 — 26
node tests/steering.test.mjs                       # steering 队列 drain — 8
node tests/todo.test.mjs                          # todo 模型 + 折叠策略 99 项
node tests/shell-output.test.mjs                  # 输出净化器 21 项
node tests/shimmer.test.mjs                     # shimmer 扫描动画引擎 — 10
node tests/truncation.test.mjs                    # 结果落盘截断 + 窗口感知阈值 21 项
node tests/approval-rpc.test.mjs                  # RPC 审批兜底（select/confirm）21 项
node tests/resume-guard.test.mjs                  # swarm resume 守卫 6 项
node tests/webfetch.test.mjs                      # web 内容提取 12 项
node tests/plugin.test.mjs                        # 插件 manifest/发现 17 项
node tests/renderer.test.mjs                      # 增量渲染器 buffer/tree 16 项
node tests/stream-rules.test.mjs                  # 流式 entry 规则 14 项
```

测试支持 Node 22/24/26（22.6–22.17 走 `--experimental-strip-types`，更早的用 `tests/ts-esm-loader.mjs` TypeScript 转译；22.18+ 原生擦除类型）。CI 在每次 push 和 PR 上跑完整矩阵——macOS + ubuntu + windows × node 24/26。


## Roadmap

- **i18n** — harness 界面文案与通知双语化（文档已拆分中英；项目页已有 EN/中 切换）
- **公式渲染转正** — 待压缩路径的上下文安全性确认后，合入 `feature/math-renderer`
- **clustered diff 预览** — edit/write 审批消息中的 ±3 行聚簇 diff（P1 批次延迟项）
- **真全屏** — 暂停遮罩已覆盖整个终端（0.9.19 已发布）；任务浏览器 container swap 全屏（kimi 任务浏览器模式）仍待做，不用 alt screen，保留终端 scrollback

## 依赖

- Pi >= 0.80.0
- `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`@earendil-works/pi-tui`（peers）
- `typebox`

**无需伴随扩展** — 单独安装即可满血使用。0.7.4 起 `ask_user_question` 和 `todo_list` 已原生内置。

## 实验分支

- [`feature/math-renderer`](https://github.com/MuseLinn/pi-muselinn-harness/tree/feature/math-renderer) — 通过 [txm](https://github.com/thatmagicalcat/txm) 在助手消息中渲染 `$$...$$` 显示公式（单元格级 2D 排版，Windows Terminal 可用；无图像协议）。上下文安全：每次 LLM 调用前恢复原始 Markdown。`cargo install txm` 后以 `/tui math on` 启用。

## 致谢

本扩展的设计和实现参考了以下开源项目，在此表示感谢：

### [Kimi Code](https://github.com/MoonshotAI/Kimi-code) (Moonshot AI)
- Agent Swarm 并发执行架构（max_concurrency worker 池、30min 超时、run_in_background）
- Goal 系统设计（GoalActor 追踪、Budget Report、blocked 3 轮阈值、Context 注入）
- Plan Mode 生命周期（enter/exit/approve/reject、ExitPlanMode 读盘）
- Permission 策略链（auto/yolo/manual、destructive 必问、AGENTS.md 优先级）
- Cron 定时任务（5 字段 + jitter + 7 天 stale + 50 上限）
- TUI 组件设计（盲文进度条、三栏任务浏览器、`wrapWithSideBorders` 闭合框编辑器）
- 取消/恢复机制（AbortSignal 链、UserCancellationError）

### [pi-spark](https://github.com/zlliang/pi-spark) (zlliang)
- 编辑器上边框信息位设计（spinner + 工作状态 + 模型名嵌入边框）
- 组件替换式 TUI 改造路径（`setEditorComponent` / `setFooter` / `setWidget`）

### [@narumitw/pi-goal](https://www.npmjs.com/package/@narumitw/pi-goal) (narumitw)
- Goal Queue FIFO + Auto-switch 机制
- usage_limited / budget_limited 状态设计
- Wrap-up 指令注入（预算耗尽后的行为）
- Stale Tool Blocking 设计
- Compaction 保留策略

### [pi-codex-goal](https://www.npmjs.com/package/pi-codex-goal) (fitchmultz)
- Goal 持久化方案（appendEntry + session_start 恢复）
- Goal 状态转换逻辑
- Budget 检查机制
- Recovery Machine 概念（简化版）

---

**注意**：本扩展大部分为独立实现。例外：`packages/core/tui/box.ts` 的 `wrapWithSideBorders` 移植自 Kimi Code（MIT），已保留出处注释并按 MIT 条款使用。

## Changelog

完整版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## License

MIT
