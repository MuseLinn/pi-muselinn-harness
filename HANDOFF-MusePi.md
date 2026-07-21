# MusePi — Design Brief for KimiWork

> 基于 [Pi coding agent](https://pi.dev) 构建自己的 agent（参考 OMP 和 Kimi Code），
> 当前阶段：extension 快速迭代 → @muselinn/core → 逐层 fork。

## 一、现有资产：pi-muselinn-harness

已发布的 npm 扩展（`pi-muselinn-harness`，当前 v0.7.3），安装即用：

```
pi install npm:pi-muselinn-harness
```

### 八个模块 | 245 项测试 | ~50 个 TypeScript 源文件

| 模块 | 说明 | pi 依赖 |
|------|------|---------|
| **Swarm** | 多子代理并行编排，worker 池 + 盲文网格 TUI + 任务浏览器（ctrl+shift+t） | 事件 API |
| **Goal** | 目标生命周期 + 预算 + 熔断 + FIFO 队列 + 会话持久化 | 事件 API + 会话 |
| **Plan** | 只读探索 → 写计划 → 审批解锁 + 工具白名单 | 事件 API |
| **Permission** | 18 级策略链（auto/yolo/manual），破坏性命令保护 | 事件 API |
| **Hooks** | 16 事件 + 可阻断 PreToolUse/Stop + 退出码语义 + fail-open | 事件 API |
| **Skills** | 7 级作用域扫描 + 去重诊断 + AGENTS.md 变体 | 事件 + 文件 |
| **Task** | 后台任务 + cron 定时 + 持久化队列 | 事件 + 会话 |
| **TUI** | 闭合框编辑器（╭╮╰╯）、上边框 spinner + 状态、三种样式热切换 | `CustomEditor` API |

此外配套了：
- 项目网站（GitHub Pages，pi.dev 架构术语窗口）
- 双语 README（中 / EN）
- 自举开发教学页面 `/self-hosting`

### 架构约束

pi 的 extension API 提供了：
- `ctx.ui.setEditorComponent(factory)` — 自定义编辑器渲染
- `ctx.ui.setWorkingVisible(bool)` / `ctx.ui.setStatus()` — 状态栏
- 事件总线：`agent_start/end`, `tool_execution_start/end`, `message_update`, `session_start/shutdown`
- `CustomEditor` 基类（可继承，super.render(width) 拿到默认内容）

**extension 不能做：**
- 修改 pi-core 的渲染管线（每帧 O(全历史) 全树重渲，对大会话成本较高）
- 拦截模型输出流（流式规则注入）
- 改编辑格式（hash-anchored edit、自定义的 tool call <-> edit 流）
- 加原生层（Rust 工具 Rust grep/glob/edit）
- 替代 pi-tui 的终端驱动（terminal input/output）

## 二、参考对象

### OMP（OpenCode）— Rust 原生 fork，18.5k stars

- 从 pi v1 fork，核心用 Rust 重写（55k 行，3 个 crate：`pi-iso / pi-natives / pi-shell`）
- 实现了 hash-anchored edit、Rust grep/glob、自定义 TUI
- 代价：独立构建（Cargo + Bun）、持续合上游、独立 CI/CD
- **方向判断**：MusePi 要做类似原生层投入才需到这一步

### Kimi Code — 精致 TUI 的参考标准

- ours = boxed editor (╭╮╰╯)、上边框 spinner + 状态文本
- Kimi 的 TUI 是自研的，不依赖 pi-tui
- 在 TUI 精细度上应该对标

### Pi 当前版本（v1）

- 有事件总线、自定义编辑器、footer 状态栏
- 渲染合并限速（`requestRender` coalesced + 16ms cap）
- TUI 卡顿瓶颈：pi-core 的 `doRender()` 每帧重渲全部组件

## 三、「两条线」策略

```
┌─────────────────────────────────────┐
│  @muselinn/core                      │ ← 纯逻辑层，零 pi 依赖
│  (swarm/goal/plan/permission/hooks/  │    两部分可同时使用
│   skills/task 的类型、算法、持久化)  │
└─────────────────────────────────────┘
    ↑ 两种消费方式
┌──────────────┐   ┌──────────────────┐
│ extension     │   │ MusePi (fork)    │
│ （继续迭代）  │   │ 继承 pi 核心 +   │
│ pi install    │   │ 重写渲染层/工具   │
└──────────────┘   └──────────────────┘
```

## 四、待决策的问题

1. **core 的边界在哪？**
   - 现有 8 模块哪些进 core（swarm/goal/plan/permission/hooks/skills → 纯逻辑不难拆）
   - TUI 层（box/editor/timing）进 core 还是按扩展专用
   - 基建（completions、session 包装）

2. **fork 的 scope**：
   - 只重写 TUI（绕过 pi-core 渲染瓶颈）？
   - 还是连工具执行一起 fork（Rust 原生层 + hash-anchored edit）？
   - 要不要流式规则注入（输出流截获改写）？

3. **TUI 策略**：
   - 继续用 pi 的 CustomEditor API → 受限于 pi-tui 渲染管线
   - 自己接管终端输出（替换 pi-tui）→ 完整的 TUI 控制
   - 折中：扩展层 + 独立 widget（swarm 的盲文网格是 widget）

4. **版本管理**：
   - extension 继续发布 pip 包（0.7.x），core 从 0.1 开始
   - MusePi fork 什么时候开仓？

5. **与 pi 上游同步策略**：
   - 跟 OMP 一样定期 rebase？还是 pin 一个已知 workable 版本？

## 五、补充需求（第二轮输入）

### 组件化与生态

MusePi 要对标 OhMyPi 的完整度：**插件、扩展、skills、agents 四类组件的统一管理**
（发现 / 安装 / 启停 / 配置 / 更新），不只是 pi 现有的 package 安装。配置 schema
放 core，管理 TUI 在 fork。

### 自带伴随工具（替代外部依赖）

当前 harness 文档推荐用户另装 rpiv-todo、rpiv-ask-user-question 等第三方扩展。
MusePi 要把这些复现为**原生一等公民**：
- todo 浮层（与 goal/task 状态打通，不是独立清单）
- 交互式问卷 / 确认工具（ask-user-question，权限审批共用同一套交互组件）
- btw 类轻量旁注能力

### Kimi Code / OhMyPi 特性复现

- **LSP 懒加载**：语言服务器按需启动、空闲回收，不常驻
- **分 agent 配置模型**：主 agent / subagent / 后台任务各自独立的
  provider+model+thinking level 配置（swarm 已有雏形，升级为通用机制）
- 最大化吸收两边的现代化 TUI 风格与功能实现

### 真全屏 TUI（条件达成后）

pi-core 目前不支持 alternate screen，extension 时代的伪全屏已验证不可行并删除。
fork 替换渲染层后具备条件：参考 opencode/OpenTUI，实现真全屏模式
（alternate screen + 完整布局管理，编辑器/历史/面板分区，而非滚动流追加）。

### 交互式内容的中断恢复（2026-07-21 修订：采用 kimi 模式）

合盖待机、终端关闭、进程退出都会打断进行中的交互（问卷等待回答、审批
等待确认、goal 等待判据）。**修订后的策略：不持久化/重放交互本身，
而是恢复一致的状态 + 合成中断证据，让模型重新驱动**（kimi 模式，
比持久化问卷状态机简单且健壮）：

- **未完成的工具交换**：恢复时合成 interrupted 结果收尾（"Tool execution
  was interrupted…Do not assume the tool completed successfully."），
  模型下一轮可据此重新发起（kimi `loopEventFold.ts:210-255`）
- **goal**：重放到 `active` 的强制改 `paused`（reason 记录）；`complete`
  的清掉；wall-clock 用持久化锚点结算跨崩溃时长（kimi `goalService.ts:832-847`）
- **后台 task**：replay → 磁盘加载 → reconcile；磁盘上仍 running 的标记
  `lost`，并把"任务丢失+resume 指引"重新喂给模型（kimi `taskService.ts:496-503`）
- turn 正常结束时，该 turn 的 pending interaction 统一 cancel
- 恢复时要区分「等待期间世界已变化」（如审批期间文件被改动）并显式提示

### 哈希锚定编辑（2026-07-21 修订：提前到本期，W4）

harness 和 pi-core 目前都没有。它是 OMP 的私有特性（hashline：read/search
输出带 `[path#TAG]` 快照锚点，edit patch 以 TAG 锚定并与磁盘逐行校验，
漂移拒绝 + 3-way merge recovery）。OMP 自报 benchmark：弱模型编辑成功率
6.7%→68.3%、输出 token −61%。**用户 2026-07-21 决策：提前到现在做**
（fork `packages/musepi/hashline/`，默认开启、`musepi.edit.hashline` 可关），
不再与 Rust 原生层同闸门。

## 五、范围扩展（用户补充需求，规划时必须纳入）

在 KimiWork 的 Phase 规划之外，用户明确要求 MusePi 的目标形态：

1. **组件化生态**：和 OhMyPi 一样有完整的 plugins / extensions / skills /
   agents 管理体系——不只是"兼容 pi 扩展"，而是自己的组件注册、发现、
   启用/禁用、配置分层机制。

2. **伴随工具自有化**：补齐目前依赖外部 pi 扩展的功能——todo 浮层
   （替代 rpiv-todo）、交互式问卷（替代 rpiv-ask-user-question / btw）。
   做 harness 原生版本，与 goal / permission / swarm widget 深度集成。

3. **复现两家特有功能**：
   - Kimi Code 式 **LSP 懒加载**（按需唤起语言服务、诊断注入工具结果；
     extension 层可做——注册独立 LSP 工具，不依赖 pi-core 改动）
   - **分 agent 配置模型**（swarm 子代理各自指定 provider/model/thinking
     level；我们已有 task-aware model resolution 的雏形，需产品化）
   - OhMyPi 式 **hash-anchored edit**（fork 限定：edit 工具契约层面，
     读时记录内容哈希、写时校验，防过期上下文编辑）

4. **现代化 TUI 集大成**：吸收 Kimi Code（闭合框编辑器、widget 体系）
   与 OhMyPi 各自的 TUI 优点；**终极目标：真全屏 TUI**（OpenTUI /
   alternate screen 级别——pi-core 目前不支持 alternate screen，此为
   fork 的核心动机之一，应写进 fork 的里程碑而非远期愿望清单）。

5. **哈希锚定编辑的现状澄清**：pi-muselinn-harness 当前**没有**任何
   哈希锚定机制（全仓唯一 hash 是 cron jitter 用的 `hashString`）；
   pi-core 的 edit 工具同样没有。这是 OMP 的 fork 级特性，不要在
   extension 阶段做半吊子复刻（注册同义替代工具无法保证模型弃用
   内置 edit）。

### 对 Phase 规划的影响

- Phase 1（core 抽取）不变，但 core 的模块清单要加上「伴随工具」
  （todo / ask-user-question）的纯逻辑部分。
- 「分 agent 配置模型」属 extension 阶段就能交付的功能，建议插进
  extension 0.8.x 的路线，不必等 fork。
- 「LSP 懒加载」同样 extension 可做，独立排期。
- fork 的硬触发条件修订为：**真全屏 TUI（alternate screen）+
  hash-anchored edit + 流式规则注入** 这一组打包，而不是只看渲染性能。

