# MusePi — 总体规划（对 HANDOFF 五问的回答）

> 输入：`HANDOFF-MusePi.md` + 对 pi-muselinn-harness v0.7.3 全仓的依赖扫描
> （50 个 TS 文件，仅 8 个 import `@earendil-works/*`，纯/耦分界 de facto 已存在）。
> 本文档对每个待决问题给出**明确决定**，而非选项罗列。

## 决策总览

| # | 问题 | 决定 |
|---|------|------|
| 1 | core 边界 | 42 个纯逻辑文件全部进 `@muselinn/core`；引入 3 个 Port（AgentRunner / Persistence / EventMap）+ 目录布局参数化 |
| 2 | fork scope | **只重写 TUI/渲染层**。Rust 原生层与 hash-anchored edit 明确推迟到 MusePi 1.0 之后再评估 |
| 3 | TUI 策略 | extension 维持 CustomEditor 现状；fork 内用自研增量渲染器替换 pi-tui，保留 pi extension API 兼容层 |
| 4 | 版本管理 | extension 继续 0.7.x→0.8（切到 core 时）；core 从 0.1.0 起；fork 仓库在 TUI 原型可跑通一轮会话时开仓（pre-alpha 标记） |
| 5 | 上游同步 | pin 已知可用版本 + 月度 selective cherry-pick；不做 OMP 式持续 rebase |

---

## 一、core 边界（已定）

### 进 `@muselinn/core` 的（42 文件，零 pi import）

| 模块 | 内容 | 备注 |
|------|------|------|
| goal/ 全部 7 文件 | 生命周期、预算、熔断、FIFO 队列、持久化 | 最干净的模块，pi 接缝已是 `any` + 注入 |
| plan/ 全部 5 文件 | 只读白名单正则、审批流 | 修掉 `plan/commands.ts:18` 的 CJS `require('node:os')` |
| permission/ 全部 6 文件 | 18 级策略链 | 保留对 `../hooks` 的跨模块 import（core 内部合法） |
| hooks/ 全部 3 文件 | TOML 解析、executor、HookEngine | `registerHooks(pi)` 的 pi 事件名映射移到 adapter |
| skills/ 全部 3 文件 | frontmatter、7 级扫描 | `.pi/` 目录约定参数化（见下） |
| swarm/ 6 文件 | `types / helpers / estimator / report / task-list-utils / index` | 盲文数学、宽度计算、网格布局全部纯逻辑 |
| swarm/widget.ts 前半 | `buildWidgetLines / buildGoalStatus / colorBar / computeWidgetFingerprint`（L17–291） | 在 L291/313 处拆文件 |
| task/cron.ts | cron 解析与调度 | `bind(pi)` 收窄为只注入 `sendUserMessage` |
| task/index.ts 的状态半 | `serializeTask` / `restore(entries)` 序列化逻辑 | 与会话 spawn 半拆开 |
| tui/ 5 文件 | `box / config / parse / switch / timing` | `box.ts` 对 `swarm/helpers` 的 `visibleWidth` 依赖合并为 `core/text-utils` |
| completions.ts、state.ts | 补全构建器、全局标志 | completions 已有"无 pi import"契约注释 |

### 留在 adapter（extension）的（8 文件）

`index.ts`（入口/工具注册）、`swarm/subagent.ts`、`swarm/commands.ts`、`swarm/task-browser.ts`、`SwarmWidgetComponent`、`task/index.ts` 的会话 spawn 半、`tui/editor.ts`（79 行 CustomEditor 子类）、`tui/index.ts`。

### 必须引入的 3 个 Port + 1 个配置

这是本次抽取**唯一真正的设计工作**，其余都是搬文件：

```ts
interface AgentRunner {        // swarm/subagent 与 task 的会话 spawn
  spawn(spec: AgentSpec): Promise<AgentHandle>;
}
interface PersistencePort {    // goal/task/cron/plan 的 appendEntry + getEntries
  append(entryType: string, data: unknown): void;
  entries(): Iterable<[string, unknown]>;
}
interface EventMap {           // pi 事件名 ↔ core 内部规范事件名
  bind(host: unknown, handlers: CoreEventHandlers): void;
}
interface ScopeDirs {          // 替代硬编码 ~/.pi / .pi 布局
  projectDir: string; agentDir: string; homeDir: string;
}
```

extension 侧用 pi API 实现这三个 Port；MusePi fork 侧用原生实现复用同一份 core。245 个测试随纯逻辑文件整体搬迁，jiti loader 换成正常 ts 构建（vitest 或保留 node:test 均可，抽取时顺手统一）。

### 工具 schema 注意点

`index.ts` 里工具参数用了 pi-ai 的 `StringEnum`。决定：core 内用纯 typebox 定义 schema，adapter 包装枚举。工具**定义**留在 adapter，工具**逻辑**（handler 主体）在 core。

---

## 二、fork scope（已定：只重写渲染层）

**决定：MusePi = pi-coding-agent 核心 + 自研渲染/TUI 层 + 原生集成 @muselinn/core。**
不做 Rust 原生层，不做 hash-anchored edit（至少 1.0 前）。

理由：

1. **动机对齐**。HANDOFF 里 extension 天花板的五条中，真正痛的是渲染管线（每帧 O(全历史) 全树重渲）和终端驱动。hash-anchored edit / Rust grep 是 OMP 的差异化，但那是 55k 行 Rust + Cargo/Bun 独立构建 + 持续合上游的代价——单人维护阶段不划算。
2. **流式规则注入不需要 Rust**。fork 后在 agent loop 的消息流上截获改写即可，这是 TS 层的活，列为 Phase 3 的独立 milestone。
3. **生态兼容是 MusePi 相对"从零写 agent"的最大资产**。保留 pi 的 extension API 表面（事件总线、CustomEditor、ui.setStatus 等），意味着 termdraw 等已装扩展和 pi 生态继续可用。重写工具执行层会直接毁掉这一点。

触发重新评估的条件（写死，避免日后摇摆）：TUI fork 稳定发布后，若出现 (a) 大会话下工具执行本身成为瓶颈且 profile 证明在 grep/glob/edit，或 (b) 编辑失败率因上下文漂移显著上升，再启动原生层评估。

---

## 三、TUI 策略（已定：双轨）

- **extension 轨（现在 → MusePi 发布）**：维持 CustomEditor 路线不动。box editor、spinner、样式热切换继续迭代，盲文网格等重渲染需求走独立 widget（swarm 已验证这条折中可行）。接受 pi-tui 管线上限，不在 extension 里做对抗性 hack。
- **fork 轨（MusePi）**：自研渲染器替换 pi-tui，核心设计约束三条：
  1. **保留式组件树 + damage tracking**：每帧只重算脏区域，禁止 O(全历史) 全树重渲；滚动历史固化为静态 buffer，只对 tail 做增量 append。
  2. **渲染与逻辑解耦**：组件输出虚拟行缓冲（string[]，与 core 的 `buildWidgetLines` 等纯函数天然对接），diff 后写终端。这就是 core 里那一堆纯 line-builder 函数的归宿——extension 时代它们喂 CustomEditor，fork 时代它们直接喂渲染器。
  3. **16ms 帧预算 + requestRender 合并**：保留 pi 现有的 coalescing 思路，但把合并点从"全树"下移到"脏节点"。

Kimi Code 的 TUI 精细度（box 编辑器、上边框 spinner、状态文本）作为对标标准，已在 extension 的 tui 模块验证过视觉方案，fork 只是换引擎不换设计。

---

## 四、版本管理（已定）

| 包 | 版本线 | 节奏 |
|----|--------|------|
| `pi-muselinn-harness`（extension） | 继续 0.7.x 功能迭代；切换到 `@muselinn/core` 依赖时发 **0.8.0** | 快速迭代主战场，用户无感迁移 |
| `@muselinn/core` | 从 **0.1.0** 起，独立 semver | 抽取完成即发布；Port 接口在 1.0 前允许 break |
| MusePi（fork） | 0.0.x pre-alpha | TUI 原型跑通一轮完整会话（输入→流式输出→工具调用→box editor）时开仓，README 明确标注 pre-alpha |

开仓不等于宣传。0.0.x 阶段目的是让 CI、upstream sync 流程、issue 模板先转起来。

---

## 五、上游同步（已定：pin + 月度 cherry-pick）

不做 OMP 式持续 rebase。单人维护下 rebase 高频冲突会吃掉全部开发时间。

1. **pin**：fork 基点选当前验证过的 pi 版本（extension peer dep 声明 `>=0.80.0` 的那条线），在 fork 的 `UPSTREAM.md` 记录基点 commit。
2. **月度窗口**：每月检查一次上游 release，只 cherry-pick两类变更——agent loop 正确性修复、extension API 新增（生态兼容需要）。渲染层变更直接忽略（已被替换）。
3. **冲突面控制**：因为 fork 改动集中在 TUI 层，而上游演进集中在 agent/工具层，两者文件交集天然小，cherry-pick 成本可控。若某月上游大改 extension API，优先保兼容层，必要时发 MusePi minor 公告。

---

## 六、路线图（两条线并行）

```
Phase 1  core 抽取（2–3 周）
  ├─ 建 @muselinn/core 包，搬 42 文件，定义 3 Port + ScopeDirs
  ├─ 245 测试随迁并接 CI
  └─ extension 0.8.0 改为依赖 core，行为不变（回归测试兜底）

Phase 2  MusePi TUI 原型（4–6 周）
  ├─ fork pi，pin 基点版本，建 UPSTREAM.md
  ├─ 自研增量渲染器替换 pi-tui（damage tracking + 虚拟行缓冲）
  ├─ OMP 式菜单/配置系统（设置 TUI、主题、键位——配置 schema 放 core）
  ├─ pi extension API 兼容层（termdraw 等扩展可直接加载）
  └─ core 原生集成：swarm/goal/task/todo 成为一等公民 UI，不再是扩展挂件

Phase 3  差异化（按优先级，每个独立可发布）
  ├─ 流式规则注入（agent loop 截获改写，TS 层实现）
  ├─ swarm 盲文网格等 widget 升级为渲染器原生组件
  └─ 大会话性能 profile 报告 → 决定是否需要原生层（Phase 4 闸门）

Phase 4  Desktop（TUI 稳定后启动）
  └─ core 已是 UI 无关纯逻辑，Desktop 壳（Tauri 或 Electron，届时再选）
     复用 core + 共享渲染逻辑；不在 TUI 稳定前做任何 Desktop 设计投入
```

**并行线**：Phase 1–3 期间 extension 继续按现有节奏发版，新功能先落 core（纯逻辑）+ adapter（薄接线），fork 自动继承。这就是"两条线"结构的全部意义——fork 永远不阻塞 extension 用户。

## 七、最先动手的一件事

**Phase 1 第一步**：在仓里建 `packages/core/`，先把 goal/（最干净、测试最全）整体迁入并定义 `PersistencePort`，跑通 245 测试中的 goal 部分。这一步能验证 Port 设计是否成立，成立后再批量搬其余模块——不要一次性全搬。

---

## 八、执行进度（2026-07-21 夜更）

- [x] **Phase 1 全部完成**（`2bf8260`）：goal/skills/tui/swarm/task 全部迁入 `packages/core/`，grep 零 pi import；`PersistencePort` + `ScopeDirs` 落地；cron bind 收窄为 sendPrompt 注入
- [x] **A 队列功能批**（`2a64308`..`7c034ef`）：ask_user_question（共享编号对话框）、todo_list+面板、swarm 权限门控（共享管理器，/mode 天然广播）、manual 审批面板（分工具标题+拒绝理由）、编辑器锚定（913d0422 同款）、toolResultTruncation、resume 守卫、fetch_url、插件 manifest 六件套；测试 245 → 362
- [x] **渲染器脚手架**（`c743ba0`）：`packages/renderer/`（虚拟行缓冲 + damage-tracked 组件树 + 16ms 合并帧循环），378 测试全绿
- [x] **B⑩ fork 建仓**：https://github.com/MuseLinn/MusePi （私有，pre-alpha）——squash 导入 pi @ `ff992261`（0.80.10 线），`UPSTREAM.md` 记录 pin 与月度 cherry-pick 策略；`.github/workflows` 已剔除（PAT 无 workflow scope）；渲染器已随仓入库
- [x] **B⑪ 渲染层集成**（fork `b670e275`）：pi-tui Container 增加可选 `fingerprint()` 协议 + 逐子节点 damage 缓存（未实现指纹的组件行为不变）;AssistantMessage/UserMessage 组件带指纹——静定历史每帧零重渲（O(历史) → O(变更)）;pi-tui 全套件回归通过
- [x] **B⑫ 兼容层核实**：fork 完整加载 pi-muselinn-harness 全部模块；`pi -p` 会话跑通（`musepi-ok`）、扩展工具真实执行（`todo-done`，kimi-for-coding 模型）
- [x] **B⑬-a @musepi/core workspace 包**（fork `a5166004`）：vendor + tsgo 严格构建通过；顺手抓出并修复 6 个 jiti 永不检查的真实 bug（tryRestoreFromSession 残留调用=潜在崩溃、nullable、目录 import、re-export 无本地绑定、parameter property、单引号无扩展名）——harness 侧已推送修复并统一 .ts 扩展名约定
- [x] **B⑬-b/c/d goal 原生集成**：原生工具注册（agent-session-services 注入 customTools）+ 原生接线（appendCustomEntry 持久化、message_end turn 记录、footer 徽标走现有 status 通道、rebind 安全）；端到端验证 create→get 状态回环；husky 全检（biome/tsgo/shrinkwrap/install-lock/browser-smoke）通过
- [x] **B⑬-e todo 原生集成**（fork `cc603eb2`）：todo_list 原生工具 + 内联面板走 interactive-mode widget 通道；ctrl+t 有 todo 时切面板、空表回落 thinking 切换；会话验证 `native-todo-ok`
- [x] **B⑭ 配置系统**（fork `aedf3a01`）：core schema（goal.badge/todo.maxVisible/swarm.*/tui.*/truncation.*，深合并+逐字段文档，12→9 断言修正后全绿）+ SettingsManager `musepi` 嵌套键 + getMusepi()，goal/todo 原生已消费设置
- [x] **B⑬-f swarm 原生集成（核心）**（fork `558d07dc`）：subagent 执行机制（fork 内部 API 直连）+ 前台编排全量移植（模型自动路由/渐进投放/指纹门控 widget/onUpdate 摘要/resume 记录）；2 项 explore swarm 会话实测产出完整 completed 报告；`run_in_background` 待后台 task 原生后开放（明确报错不静默）
- [x] **B⑬-f 余量：后台 task/cron 原生 + swarm 后台变体**（fork `67a73e32`+`b1799824`）：BackgroundTaskManager 移植（50 上限/7 天 stale/增量持久化/净化输出）；run_background/task_list/task_output/task_stop + cron 三工具 fake-pi 收集注册；cron 走 session.prompt 原生投递；swarm `run_in_background` 全链路实测（注册→task_list→task_output block 等待完成）
- [x] **B⑮ transcript 层**（fork `edd01d7c`+`e7f9db96`）：L1 模型（turn/interaction）+ L2 幂等 ops（条目组 splice 替换）+ store（rebuild/sync/聚合/turn 分页）；首个消费者 `/transcript` 命令 + rebind 全量重建；真实后台 swarm 会话文件映射验证（11 条目 → 2 turn 3 工具调用 1 错误轮）
- [x] **B 阶段验收：box editor 原生**（fork `f1296fbe`）：MusepiBoxedEditor 成为 fork 默认编辑器（boxed 默认/compact/plain 回落 pi 原生）；上边框 spinner+工作状态 左槽、模型名 右槽（settings 控制）；渲染验证通过
- [x] **C⑯ 流式规则注入**（harness `7f222de` + fork 集成）：per-turn 规则注入引擎落 core，agent loop 截获改写（TS 层，无需 Rust）
- [x] **C⑰ 真全屏（container swap）**：采用 kimi/OMP 同款取舍——主界面 inline，全屏仅用于模态 overlay；不做 alt screen 主界面
- [x] **C⑱ 大会话渲染 profile**（fork `docs/RENDER-PROFILE.md`）：2000 消息 ~1ms/帧，**渲染层不需要原生层**；下一道闸门是工具层（grep/glob/edit）profile
- 记录在案（2026-07-21 纠偏）：
  - ~~kimi mode-aware 输入历史不可移植~~ → **可移植**：pi 编辑器本有 `!`/`!!` bash 模式，4 钩子在 pi-tui Editor，port ~60 行（列入 W1）
  - ~~clustered diff 预览延后~~ → kimi 实况是"流式只显示进度行 + 审批/预览用 clustered diff"，照此做（列入 W1）
  - 「分 agent 模型配置」是 MusePi 自研需求（kimi 为继承制），参照 OMP model-roles（列入 W2）
  - kimi 无长期记忆系统；记忆按 OMP × MiMo-Code 综合方案（列入 W5）
  - hash-anchored edit 提前到本期（OMP hashline，用户 2026-07-21 决策，列入 W4）
- **下一阶段路线图见会话计划**：W1 编辑器 → W2 模型角色 → W4 hashline → W3 LSP → W5 记忆 → W6 TUI 细节包
- [x] **W1 编辑器**（fork `8c731392`）：pi-tui Editor 移植 kimi 4 钩子（historyFilter/onRecall/onHistoryDraftSave/Restore）+ interactive-mode 接线（bash 模式历史隔离，召回经 onChange 自动重算模式，不接 onRecall）；clustered diff 算法全量 port 到 core（注入式 DiffStyles 保持零依赖，18 断言）。实况记录：fork Edit 流式本就不渲染活 diff（argsComplete 后才出 preview），无红墙问题；现有 `generateDiffString`+`renderDiff` 已等价 clustered 且带词级高亮，故 clustered 暂不替换消费者
  - 后续项：**审批面板原生化**——在 `packages/coding-agent/src/musepi/` 建 approval dialog 组件，经 `permissionManager.setApprovalDialog`（core `permission/index.ts:42`，现无人调用）注入，消费 core 的 clustered diff
- [x] **W2 模型角色路由**（fork `7171f3a9`）：core `model-roles/`（六角色 default/smol/plan/advisor/task/tiny + `provider/model[:thinkingLevel]` 解析 + fallback chain + cycleOrder，25 断言）；`musepi.modelRoles.*` 入 schema（深合并+文档）；swarm 子代理消费 task 角色（显式 model 参数 > task 角色 > 自动路由），429/quota 按 fallback 链降级重跑；plan 角色接线 dormant 就位（plan 模式激活即亮）。探查结论：turn 边界快照 pi 现有机制已满足（`prepareNextTurnWithContext` 每 turn 重读模型），不重复造；主循环 fallback 接缝是 `agent-session.ts:_prepareRetry`，本期只接到 swarm 层。实测：task 角色路由 + fallback 均生效
- [x] **W7 动态工具加载**（fork `34ad3466`）：**重大发现——pi 上游原生就有 deferred-tools 线协议**（`ToolResultMessage.addedToolNames` + K3 的 `compat.deferredToolsMode:"kimi"`，投影层在加载点注入 `{role:"system", tools:[...]}`，与 kimi-code 的 contextMemory 注入 wire 结果相同）。实现：core `tool-select/`（gate/partition/ledger/plan/announcement 纯函数，19 断言）+ `select_tools` 原生工具 + 公告 transformer（每请求重述可加载清单，构造上自愈）；`musepi.toolSelect.{enabled=false,models,defer}` 配置；不支持 deferred 的 provider 自动降级为"加载后下轮进顶层 tools[]"。实测（kimi-coding/k3）：模型 select_tools → 下一步即调目标工具，一次成功。有意偏差：公告不持久化（每请求重述替代 fold diff）；未加载直接调用走 pi 通用 not found（公告已引导）
- [x] **W3 LSP 懒加载 + 写后诊断回灌**（fork `75734395`）：core `lsp/` 九件套（JSON-RPC 协议层自研零依赖、getOrCreateClient 懒启动、idle 回收、rootMarkers∩server 二进制自动检测、诊断 ledger 去重 + mutation version 防陈旧）+ `lsp` 原生工具（diagnostics/definition/references/hover/symbols/status）+ deferred diagnostics（edit/write 后异步回灌经出站 transform 注入）；`musepi.lsp.{enabled,servers,idleTimeoutMs}`；core 27 + host 10 断言（mock LSP server 集成）全绿。注：代理待机中断后由主会话接管验证提交；同 commit 含 build 必需的模型目录再生成
- [x] **W5 记忆系统 v1**（fork `a540bcb0`）：MiMo 式人可读 Markdown 存储（`global/MEMORY.md` + `projects/<pid>/MEMORY.md`，pid=sha256(cwd)[:12]）+ 零依赖 BM25（相对分数地板）+ `memory` 原生工具（search/retain/edit，retain 自动去重）+ 启动预算化注入（项目 10k/全局 6k token cap，OMP 措辞"启发式非事实、仓库优先、引用附路径"，空记忆不注入）；`musepi.memory.{enabled=false,scope,caps}` 默认关；core 18 + host 6 断言绿（隔离/注入/开关逻辑覆盖；真实会话冒烟待首次启用时验证）
- [x] **W8 swarm worktree 自动隔离**（fork `92f9f9d3`）：`git worktree add --detach` 纯 TS 实现（digest=sha256(repo+agent)[:12]），baseline=HEAD+porcelain；合并用 `git apply --check` 守卫（实测发现兄弟子代理顺序合并会使 baseline 校验失效，改为 apply-check：能干净合就自动合，冲突才 patch 落盘 `<session>/patches/<agent>.patch` 并保留 worktree）；合并经进程内队列串行化；worktree 内 commit 也折叠进 diff；非 git/嵌套 repo/git 失败全显式降级不静默；`musepi.swarm.isolation: worktree|none` 默认开。core 138 断言（9 新例真实 git 仓库集成）+ 2 子代理实测全链路（合并回主工作区、worktree 清理）
- [x] **W9 snapcompact**（fork `da741ad5`）：确定性零 LLM 压缩——pi 现有压缩是纯 LLM 摘要，`session_before_compact` 钩子 + `CompactionEntry.details` 即完整策略注册点（零侵入）。OMP 机制移植：¶ 序列化 + 定容文本帧（6000 chars/帧，PNG 光栅化是 Rust-only 不可复现）+ 边缘逐字/中部成像/超预算丢最老 + FILES 段 + 静态 summary；前次 archive 从 details 恢复展开再压缩。`musepi.compaction.strategy: default|snapcompact`（默认 default 零变化）。实测对比同一份 130k 历史：default 1507 chars/1 次 LLM 调用/有推测性内容，snapcompact 24k chars/0 调用瞬时/逐字可查。core 14 + host 12 断言绿
- [x] **W6 TUI 人性化细节包**（fork `8a413295`）：`/undo [count]`（core `undo.ts` 纯逻辑：user prompt + `!`/`!!` bash 锚点、compaction 截断、撤回回填编辑器，navigateTree 新增 `position:"before"`，16 断言）；`/btw`（内存子会话继承上下文 + DenyAll 工具 + 侧频道 reminder）；queued follow-up（pi 已有机制，只补键位 Ctrl+Q/Ctrl+Enter/Alt+Enter + Alt+Up 取回）；OSC 9 终端通知（core `notify.ts`：env allow-list/BEL 退化/tmux DCS/焦点跟踪 DECSET 1004，agent_end 触发，`musepi.notifications.{enabled,condition}`，20+ 断言）；bash 超时黄框（⏱ 黄盒区别错误红，7 断言）；Ctrl+R 历史模糊搜索（pi-tui HistorySearchComponent + 遵循 W1 模式感知，8 断言）
- [x] **上游同步 v0.81.1**（2026-07-21，fork `4185d398..42027bf6` + docs `0faf45b`）：核查发现 0.81 发布说明大部分项已在 pin 内（基点仅早一天），实际 cherry-pick 9 个：K3 thinkingFormat/reasoningEffort、#6915 streamFn 兼容恢复、#6901 compaction 重试套件、模型目录优先级+校验、brace-expansion。跳过项记录于 UPSTREAM.md（SQLite 存储、orchestrator 改名、llama.cpp 等）。core 186 + tui 712 + musepi 套件 64 绿，K3 冒烟 `k3-ok`。UPSTREAM.md 修正：pi-tui editor 入冲突面
- [x] **OMP 上游复查**（2026-07-21）：clone 后仅 3 commit（17.0.7 版本号/gateway id/vouch），无可吸收
- [x] **provider extensions 评估**（用户问）：harness 模块不碰 provider，直接价值不大；其价值在生态侧（扩展可分发带 OAuth 的自定义 provider），fork 已通过 #6915 + registerProvider 改进保持兼容面
- [x] **fallback-ask 无 UI 阻断措辞修复**（harness `e38954e` + fork `ab93674`）：block reason 明确"NOT executed"+指向权限模式，防弱模型谎报成功；harness 对 pi 0.81.0 全测试绿（401+3 断言）
- [ ] **远期评估**（W 系列后逐个重估）：DAP 调试器（28 debug ops）、eval 双内核、/collab、mnemopi 向量记忆、advisor 后台 watchdog（轻量工具版已落地，见 07-22 进展）
- [ ] **W10 /move 命令**（OMP 复现，小项）：会话中切换 cwd——`handleMoveCommand`→`applyCwdChange`（reset capabilities + 刷新 slash 命令状态/skills/AGENTS.md 重扫）。参照 `oh-my-pi/docs/slash-command-internals.md:156`。pi 无此命令，fork 原生加
- [x] **W11 MusePi 独立二进制分发 + 品牌化**（2026-07-22 完成）：bin/产物名 pi→musepi（`7b897456`）、build-binaries.sh 六平台 musepi-* 归档、release.yml tag 触发 GitHub Release（`71185683`）、--version 输出 `MusePi 0.1.0`

---

## 九、执行进度（2026-07-22 swarm 批次）

**harness（pi-muselinn-harness，main 领先 7 提交未 push，0.7.7 待手动发布）**
- [x] plan 修复 `dbc917c`：rtk 包装命令白名单（pi-rtk-optimizer 原地改写 command 导致只读命令被误拦）、Revise 保留 plan、评审超时 60s→600s 且取消不再静默 Revise、muselinn_plan 持久化接通（原为死代码）、restore 先于状态栏 + 陈旧激活态校验、工具触发的 plan 徽标刷新
- [x] goal 修复 `95bc30c`：turns 闪变（clear 无墓碑→旧 goal 复活回跳；修复=墓碑 entry + max 单调合并 + 纯展示 tick）、update_goal verified=true 规则写入工具文档
- [x] ask 三连 `02073ed`（滚动窗口/去重校验/background 后台提问/body+other 定制）+ `cac24fc`（**rpiv 吸收**：逐选项 markdown preview 双栏（≥100 列，窄屏 stacked）、n 键逐选项 notes、Chat row、结构化 kind/details 信封、保留标签校验）；测试 57→123 断言，18 套件全绿；运行时装全程同步 ~/.pi
- [x] 0.7.7 发布准备 `3055568`+`771aaa4`+`7a16031`（version/CHANGELOG/CI 矩阵/tag 触发 publish/README 中英/Pages）——用户手动发布，仓库待转 public

**MusePi（main 领先 12 提交未 push）**
- [x] 独立身份三连 `710d368c..6a1f3372`：~/.musepi 配置 home + 0.1.0 版本线 + 首迁（只拷 4 配置文件）+ updateCheck 门控 + catalog 延迟加载提速
- [x] k3 原生视频 `7adeea8a`：VideoContent 全管线 + video_url 线格式 + k3 能力声明 + read 工具魔数嗅探（限制：无 ms:// 上传、仅 read 路径）
- [x] plan/goal 镜像 `2b8de88f`；CI+release `71185683`；README 品牌化 `fa67fdf8`
- [x] **改名收尾 + 自有 update 通道** `619bc135`+`7b897456`：update 通道切到 MuseLinn/MusePi GitHub Releases（**堵死 `pi update --self` 交叉刷成上游 pi 的风险**，旧 npm self-update 整体移除）、updateCheck 默认开、bin/二进制/脚本全改名 musepi
- [x] compat.loadPiExtensions `4173649a`（默认关，opt-in 桥接 ~/.pi 扩展）；死代码 ask 镜像删除 `30833598`
- [x] **原生 advisor** `6b77d12b`（OMP 移植最小闭环）：advisor 工具→会话序列化→角色链选模型（advisor.model→modelRoles.advisor→会话模型）→一次性评审→`<advisory>` 块回注；后台 watchdog/严重度路由/花名册为有意不移植的"重"部分
- [x] Pages 站点 `3b89c263`：docs/site 单页 + Actions deploy-pages（优于 gh-pages 分支：不污染 main 历史；用户需在 Settings→Pages 选 GitHub Actions source）

**管理面差距矩阵**（详见 `projects/musepi-management-gap-matrix.md`）——剩余路线图按推荐顺序：
1. ~~update 上游风险~~ ✅（07-22 已堵）
2. **MCP 核心**（L+M）：MusePi 完全无 MCP——自研最小核心（stdio/http + tool bridge + 6 子命令；wizard/OAuth/Smithery 不做）
3. **settings 面板**（M）：现有面板扁平单列表；基于 @musepi/core schema 做最小分组面板，不移植 omp 5381 行
4. **agents 定义层**（M）：swarm 执行引擎已有，补 frontmatter agent 定义（2 scope）+ /agents 只读面板
5. **skills 统一**（S–M）：七 scope scanner 已在 fork（@musepi/core/skills）但仅 swarm 用，主会话统一到七 scope
6. extensions 管理（S）：上游 package-manager 已完整，仅文案品牌化
7. 债：`npm run build` 的 model-data manifest 校验失败（moonshotai/kimi-k3 modalities，W4 时期遗留）——发 v0.1.0 前需 `npm run hydrate:model-data` 后正式重建验证
- [x] **W4 hashline 哈希锚定编辑**（fork `e9af490a`）：引擎在 `@musepi/core/hashline`（store/parser/apply/recovery/format/prompt，22 断言零 pi import）；host 接缝 `coding-agent/src/musepi/hashline.ts`（per-session SnapshotStore，survives _buildRuntime rebuild）+ read/grep/edit 三工具接线（`musepi.edit.hashline` 默认开，关则零行为变化回退原生）；集成测试 8 断言（锚定/recovery/硬拒绝三路径）。实测：read 出 `[path#FCE0]` 锚 → 模型 `SWAP 3:` patch → applied → 铸造新 TAG `#431E` 并提示 re-anchor，全链路正确。另发现（非 W4 问题）：**extension 在 -p 无 UI 模式下 policy18 fallback-ask 会 block edit 且模型易误读为成功**——extension 维护项：无 UI 时应明确 isError 或 print 模式默认 auto 档
