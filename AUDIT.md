# pi-muselinn-harness — Kimi Code 特性对齐审计

## 1. Swarm

| 特性 | Kimi Code | 我们 | 状态 |
|------|-----------|------|------|
| agent_swarm 工具 | ✅ | ✅ | ✓ |
| agent 单任务工具 | ✅ | ✅ | ✓ |
| subagent_type: coder/explore/plan | ✅ (默认 coder) | ✅ (默认 coder) | ✓ |
| prompt_template + items | ✅ | ✅ | ✓ |
| resume_agent_ids | ✅ | ✅ | ✓ |
| 渐进式发射 (初始5 + 700ms/个) | ✅ | ✅ | ✓ |
| 指数退避重试 | ✅ | ✅ (maxRetries=10) | ✓ |
| AbortSignal 链 | ✅ | ✅ | ✓ |
| UserCancellationError | ✅ | ✅ | ✓ |
| 盲文进度条 (80ms tick) | ✅ | ✅ | ✓ |
| 完成动画 (360ms) | ✅ | ✅ | ✓ |
| 三栏任务浏览器 | ✅ | ✅ | ✓ |
| 输出捕获 (outputLines) | ✅ | ✅ | ✓ |
| 最大 128 子代理 | ✅ | ✅ (max_concurrency) | ✓ |
| 状态保存/恢复 (SavedSwarm) | ✅ | ✅ | ✓ |

## 2. Goal

| 特性 | Kimi Code | 我们 | 状态 |
|------|-----------|------|------|
| 6 种状态 | ✅ | ✅ | ✓ |
| GoalActor 追踪 | ✅ | ✅ | ✓ |
| tokenBudget | ✅ | ✅ | ✓ |
| turnBudget | ❌ | ✅ | 我们多了 |
| wallClockBudgetMs | ❌ | ✅ | 我们多了 |
| Budget Report | ✅ | ✅ | ✓ |
| wallClockResumedAt | ✅ | ✅ | ✓ |
| Goal Queue (FIFO) | ✅ | ✅ | ✓ |
| autoSwitchToNext | ✅ | ✅ | ✓ |
| appendEntry 持久化 | ❌ | ✅ | 我们多了 |
| \<untrusted_objective\> 注入 | ✅ | ✅ | ✓ |
| pauseOnInterrupt | ✅ | ✅ | ✓ |
| Goal Badge 状态栏 | ✅ | ✅ | ✓ |
| formatCompletionStats | ✅ | ✅ | ✓ |
| /goal status/pause/resume/cancel/replace/next | ✅ | ✅ | ✓ |
| /goal queue/add/prioritize/drop/skip | ❌ | ✅ | 我们多了 |
| create_goal / get_goal / update_goal 工具 | ✅ | ✅ | ✓ |

## 3. Plan

| 特性 | Kimi Code | 我们 | 状态 |
|------|-----------|------|------|
| EnterPlanMode 工具 (无参数) | ✅ | ✅ | ✓ |
| ExitPlanMode 工具 (备选方案) | ✅ | ✅ | ✓ |
| /plan toggle (无参数) | ✅ | ✅ | ✓ |
| /plan on/off | ✅ | ✅ | ✓ |
| /plan clear (清内容不退出) | ✅ | ✅ | ✓ |
| Plan 文件 (heroSlug 命名) | ✅ | ✅ | ✓ |
| ensurePlanDirectory | ✅ | ✅ | ✓ |
| 审批面板 (Approve/Reject/Revise) | ✅ | ✅ | ✓ |
| Context 注入 | ✅ | ✅ | ✓ |
| 工具限制 (只读 + plan 文件) | ✅ | ✅ | ✓ |
| 状态持久化 (会话目录) | ✅ | ✅ | ✓ |
| auto 模式跳过审批 | ✅ | ❌ (Pi 无) | ❌ |

## 4. Permission (auto/yolo/manual)

| 特性 | Kimi Code | 我们 | 状态 |
|------|-----------|------|------|
| 18 级策略链 | ✅ | ✅ | ✓ |
| 三种模式切换 | ✅ | ✅ | ✓ |
| 状态栏显示 | ✅ | ✅ | ✓ |
| 会话审批历史 | ✅ | ✅ | ✓ |
| 用户配置 deny/ask/allow | ✅ | ✅ | ✓ |
| 敏感文件检测 .env | ✅ | ✅ | ✓ |
| .git 目录保护 | ✅ | ✅ | ✓ |
| 分类器 (LLM 判断) | ✅ | ❌ (可选实现) | ❌ |
| custom approval panel UI | ✅ | ctx.ui.select/confirm | ✓ |

## 5. 后台 Task

| 特性 | Kimi Code | 我们 | 状态 |
|------|-----------|------|------|
| BackgroundTaskManager | ✅ | ✅ | ✓ |
| stop(reason) / stopByUser() | ✅ | ✅ | ✓ |
| stopReason 持久化 | ✅ | ✅ | ✓ |
| registerBackgroundTools | ✅ | ✅ | ✓ |
| appendEntry 持久化 | ❌ | ✅ | 我们多了 |

## 6. TUI 状态栏 (Footer)

| 元素 | Kimi Code | 我们 | Pi 支持 |
|------|-----------|------|--------|
| 权限模式徽章 (auto/yolo/manual) | ✅ | ✅ setStatus | ✅ |
| Plan 模式徽章 | ✅ | ✅ setStatus | ✅ |
| Swarm 模式徽章 | ✅ | ✅ setStatus | ✅ |
| Goal Badge [goal ● active · 4m · 7/20 turns] | ✅ | ✅ setStatus | ✅ |
| 当前模型 + thinking 状态 | ✅ | Pi 内置 | ✅ |
| 后台任务数 [2 tasks running] | ❌ | ❌ | ✅ 可加 |
| 后台 subagent 数 [3 agents running] | ❌ | ❌ | ✅ 可加 |
| 当前工作目录 | ✅ | Pi 内置 | ✅ |
| Git 分支 | ✅ | Pi 内置 | ✅ |
| 提示轮播 (Ctrl+K commands) | ✅ | ❌ | ⚠️ 复杂 |
| 渐变色 header "Agent Swarm" | ✅ | ❌ | ✅ 可实现 |

## 7. Pi 配色扩充

Pi 的 `dark.json` 定义了这些颜色键：
```
accent, border, borderAccent, borderMuted, success, error, warning, muted, dim, text, ...
```
不能新增自定义颜色键。但可以**通过现有颜色模拟** Kimi Code 配色：

| Kimi Code 色 | 用途 | Pi 映射 |
|--------------|------|---------|
| `primary` #4FA8FF | Plan 徽章、蓝色文本 | `border` (blue) |
| `accent` #5BC0BE | Swarm 徽章 | `accent` |
| `warning` #E8A838 | yolo 徽章、warning | `warning` (yellow) |
| `shellMode` #BD93F9 | Bash 模式 | `bashMode` (green) |
| `textDim` #6B6B6B | 辅助文本 | `dim` |
| `thinking` 渐变 | thinking 级别 | Pi 已内置 6 级 |

**结论**：现有配色可以覆盖 Kimi Code 的大部分场景，无需自定义。

## 8. 彩虹彩蛋 (Dance / Easter Egg)

Kimi Code 有一个 `/dance` 命令彩蛋：
- 8 色彩虹调色板 (深色/浅色)
- 逐字符渲染
- 3 秒流动动画 + 冻结
- 110ms 帧间隔

**适合运用位置**（在现有 Pi API 范围内）：
1. **swarm header "Agent Swarm" 渐变色标题** — 在 widget.ts 中用 Pi 的主题颜色模拟
2. **欢迎动画** — `/dance` 命令触发彩虹流动
3. **Goal 完成庆祝** — goal complete 时闪一下
4. **Swarm 启动动画** — swarm 创建时彩虹渐变

## 9. 缺失但可补的特性

| 特性 | 工作量 | 优先级 |
|------|--------|--------|
| 渐变色 "Agent Swarm" header | ~20行 | 低 |
| /dance 彩虹彩蛋 | ~50行 | 低 |
| 后台任务数状态栏 | ~15行 | 低 |
| subagent 数状态栏 | ~15行 | 低 |

## 总结

| 模块 | 对齐率 | 说明 |
|------|--------|------|
| Swarm | 100% | 完全对齐 |
| Goal | 95% | 我们还有额外功能 (turnBudget, wallClockBudgetMs, queue) |
| Plan | 92% | 唯一缺失: auto mode 跳过审批 (Pi 无 permissionMode) |
| Permission | 95% | 唯一缺失: LLM 分类器 (可选) |
| Task | 100% | 完全对齐 |
| TUI | 85% | 缺少彩虹渐变 + 后台任务/agent 计数 |
