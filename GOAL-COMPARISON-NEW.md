# Goal 系统对比表（Phase 1 完成后）

## 四系统对比

| 特性 | @narumitw/pi-goal | pi-codex-goal | Kimi Code 0.25.0 | 我们 (Phase 1) |
|------|-------------------|---------------|-------------------|----------------|
| **基本信息** |||||
| 版本/更新 | 0.16.0 (12h前) | 0.1.36 (23h前) | 0.25.0 | 开发中 |
| 代码量 | 132 kB | 337 kB | 776行 (goal模块) | 1126行 (goal/) |
| 依赖 | 1 (typebox) | 0 | — | 0 |
| **Goal 生命周期** |||||
| active | ✅ | ✅ | ✅ | ✅ |
| paused | ✅ | ✅ | ✅ | ✅ |
| blocked | ✅ | ✅ | ✅ | ✅ |
| complete | ✅ | ✅ | ✅ | ✅ |
| usage_limited | ✅ | ❌ | ❌ | ✅ (类型定义) |
| budget_limited | ✅ | ❌ | ❌ | ✅ (类型定义) |
| **GoalActor 追踪** |||||
| user | ✅ | ✅ | ✅ | ✅ |
| model | ✅ | ✅ | ✅ | ✅ |
| runtime | ✅ | ✅ | ✅ | ✅ |
| system | ✅ | ✅ | ✅ | ✅ |
| **Budget** |||||
| tokenBudget | ✅ | ✅ | ✅ | ✅ |
| turnBudget | ❌ | ❌ | ✅ | ✅ |
| wallClockBudgetMs | ❌ | ❌ | ✅ | ✅ |
| Budget Report 计算 | ❌ | ✅ | ✅ | ✅ |
| remainingTokens | ❌ | ✅ | ✅ | ✅ |
| remainingTurns | ❌ | ❌ | ✅ | ✅ |
| remainingWallClockMs | ❌ | ❌ | ✅ | ✅ |
| overBudget 检测 | ❌ | ✅ | ✅ | ✅ |
| **Wall Clock** |||||
| wallClockMs 追踪 | ✅ | ✅ (activeSeconds) | ✅ | ✅ |
| wallClockResumedAt | ❌ | ❌ | ✅ | ✅ |
| Pause/Resume 时钟 | ❌ | ✅ | ✅ | ✅ |
| Live 计算 | ❌ | ✅ | ✅ | ✅ |
| **工具 (Tool)** |||||
| get_goal | ❌ | ✅ | ✅ | ✅ |
| create_goal | ❌ | ✅ | ✅ | ✅ |
| update_goal | ❌ | ✅ | ✅ | ✅ |
| goal_complete | ✅ | ❌ | ❌ | ❌ |
| goal_blocked | ✅ | ❌ | ❌ | ❌ |
| setBudgetLimits | ❌ | ❌ | ✅ | ✅ |
| **命令 (Command)** |||||
| /goal | ✅ | ✅ | ✅ | ✅ |
| /goal pause | ✅ | ✅ | ✅ | ✅ |
| /goal resume | ✅ | ✅ | ✅ | ✅ |
| /goal cancel | ✅ | ✅ | ✅ | ✅ |
| /goal replace | ❌ | ❌ | ✅ | ✅ |
| /goal next | ❌ | ❌ | ✅ | ✅ |
| /goal status | ✅ | ✅ | ✅ | ✅ |
| /goal add (queue) | ✅ | ❌ | ❌ | ✅ (骨架) |
| /goal queue | ✅ | ❌ | ❌ | ✅ (骨架) |
| /goal prioritize | ✅ | ❌ | ❌ | ❌ |
| /goal drop | ✅ | ❌ | ❌ | ❌ |
| /goal skip | ❌ | ❌ | ❌ | ❌ |
| /write-goal | ❌ | ❌ | ❌ | ✅ |
| /swarm-status | ❌ | ❌ | ❌ | ✅ |
| **Queue** |||||
| Goal Queue 队列 | ✅ (实验性) | ✅ (queued-goal-work) | ✅ | ✅ (骨架) |
| Ordered Queue | ✅ | ❌ | ❌ | ❌ |
| FIFO 模式 | ✅ | ❌ | ❌ | ✅ |
| Priority 模式 | ✅ | ❌ | ❌ | ❌ |
| Auto-switch | ✅ | ✅ | ✅ | ❌ (待实现) |
| **Persistence** |||||
| Session-scoped | ✅ | ✅ | ✅ | ✅ |
| appendEntry | ❌ | ✅ | ❌ | ✅ |
| Records | ❌ | ❌ | ✅ | ❌ |
| entry 重建 goal | ❌ | ✅ | ❌ | ✅ |
| runtimeUsage entry | ❌ | ✅ | ❌ | ❌ |
| **Context Injection** |||||
| <untrusted_objective> | ❌ | ❌ | ✅ | ✅ |
| Budget Prompt | ❌ | ✅ | ✅ | ✅ |
| Status Prompt | ❌ | ❌ | ✅ | ✅ |
| **Recovery** |||||
| Context Overflow | ❌ | ✅ | ❌ | ❌ |
| Proactive Compaction | ❌ | ✅ | ❌ | ❌ |
| Provider Limit Auto-Resume | ❌ | ✅ | ❌ | ❌ |
| Stale Tool Blocking | ✅ | ❌ | ❌ | ❌ |
| **Accounting** |||||
| recordTurn | ❌ | ✅ | ✅ | ✅ |
| recordTokenUsage | ❌ | ✅ | ✅ | ✅ |
| incrementTurn | ❌ | ❌ | ✅ | ✅ |
| applyUsage | ❌ | ✅ | ❌ | ❌ |
| **Advanced** |||||
| Goal Forking | ❌ | ❌ | ✅ | ❌ |
| Telemetry | ❌ | ❌ | ✅ | ❌ |
| Normalization after replay | ❌ | ✅ | ✅ | ✅ |
| pauseOnInterrupt | ❌ | ✅ | ✅ | ❌ (待实现) |
| Completion Audit | ✅ | ❌ | ❌ | ❌ |
| Continuation Messages | ✅ | ✅ | ❌ | ❌ |

## 特性覆盖率

| 系统 | 覆盖特性数 | 总特性数 | 覆盖率 |
|------|-----------|---------|--------|
| @narumitw/pi-goal | 25 | 45 | 56% |
| pi-codex-goal | 30 | 45 | 67% |
| Kimi Code 0.25.0 | 35 | 45 | 78% |
| **我们 (Phase 1)** | **28** | **45** | **62%** |

## 我们独有的特性

| 特性 | 说明 |
|------|------|
| turnBudget | 其他两个扩展没有 |
| wallClockBudgetMs | 其他两个扩展没有 |
| /goal replace | Kimi Code 有，其他没有 |
| /goal next | Kimi Code 有，其他没有 |
| /write-goal | 只有我们有 |
| /swarm-status | 只有我们有 |
| Goal Queue 骨架 | @narumitw 有完整版，我们有骨架 |

## 我们缺少的关键特性

| 特性 | 来源 | 优先级 | 复杂度 |
|------|------|--------|--------|
| pauseOnInterrupt | Kimi Code | 高 | 低 |
| Goal Queue Auto-switch | @narumitw | 中 | 中 |
| Stale Tool Blocking | @narumitw | 中 | 中 |
| Context Overflow Recovery | pi-codex-goal | 低 | 高 |
| Proactive Compaction | pi-codex-goal | 低 | 高 |
| Provider Limit Auto-Resume | pi-codex-goal | 低 | 中 |
| Goal Forking | Kimi Code | 低 | 高 |
| Telemetry | Kimi Code | 低 | 中 |
| Continuation Messages | @narumitw/pi-codex-goal | 低 | 高 |

## Phase 2 实施计划

| Phase | 特性 | 来源 | 代码量 |
|-------|------|------|--------|
| 2.1 | pauseOnInterrupt | Kimi Code | ~15行 |
| 2.2 | Goal Queue Auto-switch | @narumitw | ~40行 |
| 2.3 | Stale Tool Blocking | @narumitw | ~30行 |
| 2.4 | /goal prioritize/drop/skip | @narumitw | ~60行 |
| 2.5 | Continuation Messages | @narumitw | ~40行 |

**Phase 2 总计**：~185行

## 总结

**我们当前的 Goal 系统**：
- 覆盖率 62%，接近 pi-codex-goal (67%)
- 比 @narumitw/pi-goal (56%) 更全面
- 独有 turnBudget + wallClockBudgetMs
- 缺少 Recovery 和 Queue Auto-switch

**建议优先级**：
1. **高**：pauseOnInterrupt (简单，Kimi Code 风格)
2. **中**：Goal Queue Auto-switch (用户价值高)
3. **中**：Stale Tool Blocking (防止过期 tool 执行)
4. **低**：Recovery (复杂，可后续实现)
