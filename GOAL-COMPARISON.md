# Goal 系统对比分析

## 三个系统对比

| 特性 | Kimi Code | pi-codex-goal | 我们 | Pi 可行性 |
|------|-----------|---------------|------|-----------|
| **基础功能** |||||
| Goal 生命周期 | ✅ | ✅ | ✅ | — |
| GoalActor 追踪 | ✅ | ✅ (GoalEntrySource) | ✅ | — |
| Goal 持久化 | ✅ (records) | ✅ (appendEntry) | ✅ (appendEntry) | — |
| Goal 工具 | ✅ | ✅ (3个) | ✅ (3个) | — |
| Goal 命令 | ✅ (/goal) | ✅ (/goal) | ✅ (/goal) | — |
| **Budget** |||||
| tokenBudget | ✅ | ✅ | ✅ | — |
| turnBudget | ✅ | ❌ | ✅ | — |
| wallClockBudgetMs | ✅ | ❌ | ✅ | — |
| Budget Report 计算 | ✅ | ✅ (remaining*) | ❌ | ✅ 纯计算 |
| Budget Limit Prompt | ✅ | ✅ | ❌ | ✅ 注入到 context |
| **Wall Clock** |||||
| wallClockMs 追踪 | ✅ | ✅ (activeSeconds) | ✅ | — |
| wallClockResumedAt | ✅ | ❌ | ❌ | ✅ 加字段即可 |
| Pause/Resume 时钟 | ✅ | ✅ | ❌ | ✅ 在 pause/resume 时更新 |
| **Persistence** |||||
| appendEntry | — | ✅ | ✅ | — |
| entry 重建 goal | — | ✅ (reconstructGoal) | ❌ | ✅ session_start 时扫描 |
| runtimeUsage entry | — | ✅ | ❌ | ⚠️ 需要频繁写入 |
| **Recovery** |||||
| Context Overflow 处理 | — | ✅ (recovery-machine) | ❌ | ⚠️ 复杂，可简化 |
| Proactive Compaction | — | ✅ | ❌ | ⚠️ 需要 ContextUsage API |
| Provider Limit Auto-Resume | — | ✅ | ❌ | ⚠️ 需要错误检测 |
| **Queue** |||||
| Goal Queue 队列 | ✅ | ✅ (queued-goal-work) | ❌ | ⚠️ Pi 无队列 API |
| Stale Queued Work | — | ✅ | ❌ | ⚠️ 非常复杂 |
| **Advanced** |||||
| Goal Forking | ✅ | ❌ | ❌ | ⚠️ Pi 无 fork API |
| Telemetry 追踪 | ✅ | ❌ | ❌ | ❌ Pi 无 telemetry |
| setBudgetLimits 方法 | ✅ | ❌ (在 create 时设置) | ❌ | ✅ 简单方法 |
| pauseOnInterrupt | ✅ | ✅ (abort_pause) | ❌ | ✅ 用 signal.aborted |
| incrementTurn | ✅ | ❌ (在 accounting 中) | ❌ | ✅ 简单方法 |
| recordTokenUsage | ✅ | ✅ (applyUsage) | ❌ | ✅ 在 turn_end 中调用 |
| Normalization after replay | ✅ | ✅ | ❌ | ✅ session_start 时处理 |

## Pi 可行性评估

### ✅ 完全可行 (7 个)
1. **Budget Report 计算** — 纯函数，计算 remainingTokens/remainingTurns/remainingWallClockMs
2. **wallClockResumedAt** — 在 GoalSnapshot 中加字段，pause/resume 时更新
3. **setBudgetLimits 方法** — GoalManager 新增方法
4. **pauseOnInterrupt** — 用 signal.aborted 检测
5. **incrementTurn** — GoalManager 新增方法
6. **recordTokenUsage** — 在 turn_end 事件中调用
7. **Normalization after replay** — session_start 时检查 active goal → paused

### ⚠️ 可行但需简化 (5 个)
1. **Budget Limit Prompt** — 注入到 context 事件
2. **entry 重建 goal** — session_start 时扫描 appendEntry
3. **Context Overflow 处理** — 简化版：检测 error 并 block goal
4. **Provider Limit Auto-Resume** — 检测 429 错误并暂停
5. **Goal Queue** — 简化版：用 pi.sendUserMessage 排队

### ❌ 不可行 (2 个)
1. **Telemetry 追踪** — Pi 无 telemetry API
2. **Goal Forking** — Pi 无 fork API

## 实施计划

### Phase 1: 核心补全 (优先级高)
**目标**: 补全缺失的核心功能

1. **Budget Report 计算**
   - 在 `goal.ts` 添加 `computeBudgetReport()` 函数
   - 返回 `{ remainingTokens, remainingTurns, remainingWallClockMs, overBudget }`
   - 在 `toSnapshot()` 中调用

2. **wallClockResumedAt 支持**
   - 在 `GoalSnapshot` 添加 `wallClockResumedAt?: number`
   - pause 时: `wallClockMs += now - wallClockResumedAt`
   - resume 时: `wallClockResumedAt = now`
   - complete 时: 同 pause 逻辑

3. **setBudgetLimits 方法**
   - GoalManager 新增 `setBudgetLimits(limits)`
   - 合并现有 limits: `{ ...existing, ...new }`

4. **pauseOnInterrupt**
   - GoalManager 新增 `pauseOnInterrupt(reason?)`
   - 检查 `signal.aborted` 后调用

5. **incrementTurn**
   - GoalManager 新增 `incrementTurn()`
   - `turnsUsed += 1`

6. **recordTokenUsage**
   - GoalManager 新增 `recordTokenUsage(delta)`
   - `tokensUsed += delta`

7. **Normalization after replay**
   - session_start 事件中检查 active goal
   - 转为 paused，设置 reason = "Paused after agent resume"

### Phase 2: Context 注入增强 (优先级中)
**目标**: 增强 goal 到模型的注入

1. **Budget Limit Prompt**
   - 在 `budgetBandGuidance()` 中添加剩余预算提示
   - 注入到 system message

2. **entry 重建 goal**
   - session_start 时扫描 `pi.getEntries()`
   - 找到 `muselinn_goal` 类型的 entry
   - 重建 goal state

### Phase 3: Recovery 简化版 (优先级低)
**目标**: 基础错误恢复

1. **Context Overflow 处理**
   - 检测 error message 中的 "context" 关键词
   - 自动 block goal

2. **Provider Limit Auto-Resume**
   - 检测 429 错误
   - 自动 pause goal
   - 可选：定时 resume

### Phase 4: Goal Queue 简化版 (优先级低)
**目标**: 支持多个 goal 排队

1. **Goal Queue**
   - 用数组存储多个 goal
   - 当前 goal 完成后自动切换到下一个
   - `/goal queue <objective>` 命令

## 代码量估算

| Phase | 新增代码 | 修改代码 | 总计 |
|-------|---------|---------|------|
| Phase 1 | ~150 行 | ~50 行 | ~200 行 |
| Phase 2 | ~80 行 | ~30 行 | ~110 行 |
| Phase 3 | ~100 行 | ~20 行 | ~120 行 |
| Phase 4 | ~120 行 | ~40 行 | ~160 行 |
| **总计** | ~450 行 | ~140 行 | ~590 行 |

## 优先级建议

**必须做 (Phase 1)**:
- Budget Report 计算 — 模型需要知道剩余预算
- wallClockResumedAt — 正确追踪时间
- setBudgetLimits — 动态调整预算
- pauseOnInterrupt — 用户中断时正确暂停
- incrementTurn / recordTokenUsage — 正确计数

**应该做 (Phase 2)**:
- Budget Limit Prompt — 告诉模型预算限制
- entry 重建 goal — 会话恢复

**可以做 (Phase 3-4)**:
- Recovery — 错误恢复
- Goal Queue — 多目标排队
