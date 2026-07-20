# kimi-code 调研结论（2026-07-20，基于 main @ c5b6103b）

> 四路并行调研的蒸馏版。证据行号见各分项；本文件只保留决策相关内容。
> 原始问题：kimi-code 的核心是不是 pi？K3 最佳实践要调什么？哪些好实现我们缺失？

## 一、架构事实（重要，纠正认知）

**Kimi Code 的 agent loop / 模型路由 / 会话 / 工具执行不是 pi。** 它用自研
`packages/agent-core-v2`（agent 核心）+ `packages/kosong`（LLM 协议层），
pi 系只用了一个 `packages/pi-tui`（vendored TUI 库）。

| | 核心 | TUI |
|---|---|---|
| Kimi Code | 自研 agent-core-v2 + kosong | pi-tui（vendor） |
| OMP | pi-coding-agent（fork） | 自研 + Rust 原生层 |
| **MusePi（规划）** | **pi-coding-agent（pin）** | **自研渲染器 + @muselinn/core** |

—— 与 Kimi Code 恰好是镜像路线，互不冲突，互可借鉴。

agent-core-v2 相对 pi 的最大设计代差：**loop 哑化 + aspect 化**（错误恢复链 /
压缩 / 编排器全是可注册插件，`loopService.ts:480-502`）和**每 agent 可重放
journal + 扁平 session registry**（使权限广播、跨重启 resume 成为自然产物）。
这些是 fork 阶段（Phase 2/3）的参考，extension 阶段够不着，不展开。

## 二、K3 最佳实践（MusePi/extension 要遵守的清单）

kimi-code 对 K3 **没有任何名字硬编码**——全部走模型元数据（远端 catalog +
`[models.*.overrides]`）。这是最重要的架构原则。

- **元数据驱动**：`max_context_size`（K3=1M）、`support_efforts`（K3=`["max"]`）、
  `default_effort`、`capabilities`（thinking / always_thinking）。按模型名特判 = 负债。
- **thinking effort**：三级 fallback（声明默认 → 中位档 → on）；
  `always_thinking` 模型强制 on（K3 即此类 → **UI 不该出现 thinking 开关**）；
  **最高档只持久化 enabled，不写 effort（session-only）**；已存的 `effort="max"`
  一次性迁移为 `"high"`（marker 文件防重跑）。
- **线上协议**：`extra_body.thinking={type,effort}`；preserved thinking 默认
  `keep='all'`；只发 `max_completion_tokens` 且钳到剩余窗口；不设 temperature。
- **压缩阈值**：`min(used ≥ max×0.85, used+50k ≥ max)` 双条件，按当前模型动态算，
  不能假设 256k。
- 切换模型/effort 会打穿 prompt cache，UI 应提示。

对我们的触点：goal 预算/熔断按 token 计时必须读模型元数据；footer 的
` thinking: high` 档位显示要跟着 effort 解析规则走；swarm 子代理可配
per-agent effort（kimi 在 turn 边界做模型+effort 快照，整 turn 共享）。

## 三、差距清单与复现优先级

### extension 阶段就能做（本轮起）

| 优先 | 项 | 参照 | 难度 |
|---|---|---|---|
| P0 | **AskUserQuestion 原生工具**（先单选版 ~300 行，裁剪掉 Other/多选） | kimi `question-dialog.ts`（788 行） | 中 |
| P0 | **TodoList 原生工具 + 面板**（单工具读写清三态 + session 共享；`selectVisibleTodos` 折叠策略直接可抄） | kimi `todo-panel.ts:51-112` | 低-中 |
| P0 | **shell 输出净化**（4 条正则剥 CSI/OSC/C0，渲染子进程输出前必过） | kimi `utils/shell-output.ts:13-43` | 低 |
| P0 | **footer transient hint 通道 + goal 徽标 1s 墙钟 tick** | kimi `footer.ts:223-235, 370-384` | 低 |
| P0 | **swarm 权限广播**（registry 驱动 fan-out，kimi #1948 范式） | `agentLifecycleService.ts:303-307` | 中 |
| P0 | **审批面板**（manual 档用；分工具定制标题、数字键直选、拒绝可填理由） | kimi `approval-panel.ts` | 中-高 |
| P1 | 编辑器改进：mode-aware 输入历史（4 钩子）、slash 菜单关闭后输入锚定（render 边沿检测） | `editor-keyboard.ts:82-117`、`custom-editor.ts:261-289` | 中 |
| P1 | clustered diff 视图（流式期间抑制尾部删除行） | `diff-preview.ts:88-103` | 中 |
| P1 | 语义 token 主题 + OSC 11 自动检测 | `theme/colors.ts`、`theme/detect.ts` | 低-中 |
| P1 | 子代理 resume 前所有权/空闲校验 | `agent.ts:302-316` | 低 |
| P1 | FetchURL 无鉴权 / WebSearch 未配置即隐藏 | `fetch-url.ts`、`webSearchService.ts` | 低 |
| P1 | toolResultTruncation（大结果落盘留 preview+output_path） | `agent/toolResultTruncation/` | 中 |

### fork 阶段的地基（Phase 2/3 输入）

- **transcript 层**（独立包，L1 store/L2 幂等 ops/L3 四档粒度/L4 view）——
  消息模型与渲染解耦，是 MusePi 最值得整体借鉴的地基（kimi `packages/transcript`）
- LoopErrorHandler 可排序恢复链（goal 熔断/权限降级成为一等 aspect）
- StepRequest 批合并（steer 搭车进下一请求，省 step）
- compaction 分割点合法性（不在 tool_call/result 对中间切）+ 实测上下文窗口学习
- wire Op journal + Model reducer + 版本化迁移（goal 持久化的更系统形态）
- swarm 429 挂起重排 + 启动斜坡调度（`agentRunBatch.ts:46-52`）
- runAgentTurn 的"跑 turn → 蒸馏 summary → 不足则 continuation 重试"三段式

### 证伪的假设（不用找了）

- kimi-code 没有 LSP 工具、没有 notebook 工具、没有 /share 命令、主界面不用
  alt screen（全屏接管走 container swap，输出查看器刻意内联——**我们也不该上
  alt screen**，真全屏参考 container swap 模式即可）
- Kimi 的插件是"skills+hooks+MCP+命令"声明式资源包（manifest 六件套），不是
  代码扩展——和我们已有能力维度完全重合，缺的只是"打包+分发+信任确认"层（P1）
- 权限 18 策略有两个反直觉语义要对齐：auto 模式下用户的 ask 规则不生效
  （只 deny 能压过 auto-approve，且 auto 下 AskUserQuestion 被专门 deny 防卡死）；
  yolo 模式仍保留敏感文件和 plan/goal 评审询问
