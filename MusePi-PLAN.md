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
- [ ] **B⑫-B⑮**（下一批）：extension API 兼容层在渲染器替换后复核、core 原生集成、OMP 式配置系统、transcript 层；验收=跑通一轮完整会话
- [ ] **C⑯-⑱**：流式规则注入、真全屏（container swap）、大会话 profile
- 记录在案：kimi 4b（mode-aware 输入历史）不可移植（pi 编辑器无 bash inputMode）；clustered diff 预览延后
