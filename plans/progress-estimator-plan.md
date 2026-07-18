# Progress Estimator — Braille Bar 真实进度改造

## 问题

当前 swarm 网格的盲文进度条是**假动画**：
- `incrementTicks()` 给所有 `running`/`pending` agent 同步 +1 tick
- 所有 agent 显示完全相同的 `[⣿⣿⣿⣶⢸⣀⣀⣀]`
- 不是真实进度，还造成 80ms 不必要的帧刷新

Kimi Code 用 `AgentSwarmProgressEstimator` 为每个 agent **独立跟踪真实进度**（tool call 计数），已完成 agent 的数据用于预测未完成的。

## 改造方案

### Phase 1: 真实进度（立刻见效）

**改动文件**：`swarm/types.ts`、`swarm/helpers.ts`、`swarm/index.ts`、`index.ts`

1. **`SubAgentTask` 加字段**
   - `toolCalls: number`（当前已完成的 tool call 数）
   - `estimatedTotalCalls: number`（估算总 tool call 数，简单用 `15` 兜底）

2. **去掉假动画**
   - 删除 `incrementTicks()`（在 helpers.ts）
   - 删除 `needsAnimation()`（在 helpers.ts）
   - 删除 `ticks: number` 字段（在 types.ts）
   - 删除 `computeDisplayTicks()` 中的循环逻辑

3. **`accumulatedBrailleBar` 改为基于真实进度**
   - 输入从 `ticks` 改为 `progress: number`（0~1）
   - `progress = toolCalls / estimatedTotalCalls`
   - 已完成的 agent 直接填满 `progress = 1`
   - 保留 completed fill animation（360ms）

4. **记录 tool call**
   - 在 `subscribe` 回调中每次 `message_end` + `toolCall` → `task.toolCalls++`
   - 在 `runProgressive` 的 `updateProgress` 回调中传当前 toolCalls

5. **刷新间隔调优**
   - 只在有 running agent + 有 tool call 变更时刷新
   - 降到 `250ms` 间隔（不再需要 80ms）

### Phase 2: 进度预测（增强，对照 Kimi Code Estimator）

**改动文件**：`swarm/estimator.ts`（新建）

1. **创建 `swarm/estimator.ts`**
   - 基于 Kimi Code 的 `AgentSwarmProgressEstimator` 精简版
   - `recordToolCall(memberKey)` → 记录 tool call
   - `markStarted/markCompleted` → 生命周期
   - `estimate(memberKey, nowMs)` → 返回 `{ rawTicks, displayTicks }`

2. **估算逻辑**
   - 已完成 agent 的 tool call 数 → 几何平均做 `typicalTotalCalls`
   - 每个 agent 的 `estimatedTotalCalls = typicalTotalCalls * workloadSpreadFactor`
   - `boosted`: 根据已完成 agent 的比率提前填充进度

### Phase 3: TUI 网格精简

1. 去掉 `cellLabel` 中多余的 model tag 显示（已不需要）
2. 完成后的 5s 延迟清除改为 3s
3. 刷新间隔改为 `FRAME_INTERVAL_MS = 250`

## 实现顺序

1. Phase 1 → 先去掉假动画，显示真实 tool call 进度
2. Phase 3 → 刷新间隔调优
3. Phase 2 → 预测逻辑（可选，但 Kimi 对标）
