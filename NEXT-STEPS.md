# 下一步计划

## 当前状态

**已完成**：
- ✅ Phase 1: Goal 解耦 (goal/ 目录 7 文件)
- ✅ usage_limited/budget_limited 检测
- ✅ Wrap-up 指令注入
- ✅ Tool 阻止机制
- ✅ Budget Report 计算
- ✅ wallClockResumedAt 支持
- ✅ Goal Queue 骨架

**代码量**：3898 行 (18 文件)

## 优先级排序

### 🔴 高优先级 (立即做)

| # | 任务 | 来源 | 代码量 | 价值 |
|---|------|------|--------|------|
| 1 | 删除旧 goal.ts | 清理 | -266行 | 减少混乱 |
| 2 | pauseOnInterrupt | Kimi Code | ~15行 | 用户中断时正确暂停 |
| 3 | Goal Queue Auto-switch | @narumitw | ~40行 | 完成后自动切换下一个 |
| 4 | /goal prioritize/drop/skip | @narumitw | ~60行 | Queue 操作命令 |

### 🟡 中优先级 (本周做)

| # | 任务 | 来源 | 代码量 | 价值 |
|---|------|------|--------|------|
| 5 | Stale Tool Blocking | @narumitw | ~30行 | 防止过期 tool 执行 |
| 6 | Continuation Messages | @narumitw | ~40行 | 自动续航 |
| 7 | Widget Goal 状态显示 | 扩展 | ~30行 | 状态栏显示 goal |
| 8 | Goal 完成统计 | Kimi Code | ~20行 | 完成时显示统计 |

### 🟢 低优先级 (后续做)

| # | 任务 | 来源 | 代码量 | 价值 |
|---|------|------|--------|------|
| 9 | Context Overflow Recovery | pi-codex-goal | ~100行 | 错误恢复 |
| 10 | Proactive Compaction | pi-codex-goal | ~80行 | 主动压缩 |
| 11 | Provider Limit Auto-Resume | pi-codex-goal | ~40行 | 自动恢复 |
| 12 | Goal Forking | Kimi Code | ~60行 | 目标分叉 |

## 详细计划

### 1. 删除旧 goal.ts

```bash
rm goal.ts
```

- 减少 266 行重复代码
- 避免混淆
- 已完全迁移到 goal/ 目录

### 2. pauseOnInterrupt (Kimi Code 风格)

```typescript
// goal/index.ts 新增方法
pauseOnInterrupt(reason?: string): GoalSnapshot | null {
  const g = currentGoal;
  if (!g || g.status !== "active") return null;
  return this.pause("user");
}

// index.ts 中调用
pi.on("turn_end", (event, ctx) => {
  if (event.signal?.aborted) {
    goalManager.pauseOnInterrupt("User interrupted");
  }
});
```

### 3. Goal Queue Auto-switch (@narumitw 风格)

```typescript
// goal/queue.ts 新增
function autoSwitchToNext(goalManager: GoalManager): void {
  const queue = getQueue();
  const nextItem = getNextQueueItem();
  if (!nextItem) return;
  
  // 完成当前 goal
  completeCurrentQueueItem();
  
  // 创建下一个 goal
  goalManager.createGoal(
    nextItem.objective,
    nextItem.completionCriterion,
    nextItem.budgetLimits,
    "runtime"
  );
}

// goal/index.ts 中调用
complete(actor: GoalActor = "user"): GoalSnapshot | null {
  // ... 现有逻辑 ...
  
  // Auto-switch to next in queue
  autoSwitchToNext(this);
  
  return updated;
}
```

### 4. /goal prioritize/drop/skip (@narumitw 风格)

```typescript
// goal/commands.ts 新增命令
case "prioritize": {
  const index = parseInt(rest);
  if (prioritizeQueueItem(index)) {
    ctx.ui.notify(`Item ${index} prioritized.`, "info");
  }
  break;
}
case "drop": {
  const index = parseInt(rest);
  if (removeFromQueue(index)) {
    ctx.ui.notify(`Item ${index} dropped.`, "info");
  }
  break;
}
case "skip": {
  const next = skipCurrentQueueItem();
  if (next) {
    goalManager.createGoal(next.objective, ...);
    ctx.ui.notify(`Skipped to: ${next.objective}`, "info");
  }
  break;
}
```

### 5. Stale Tool Blocking (@narumitw 风格)

```typescript
// goal/index.ts 新增
private lastGoalId: string | null = null;

shouldBlockTool(toolName: string, goalId?: string): boolean {
  const g = currentGoal;
  if (!g) return false;
  
  // 检查 goal ID 是否过期
  if (goalId && goalId !== g.goalId) return true;
  
  // 检查状态
  if (g.status !== "budget_limited" && g.status !== "usage_limited") return false;
  
  // 允许 goal 管理工具
  const allowedTools = ["get_goal", "update_goal"];
  return !allowedTools.includes(toolName);
}
```

### 6. Continuation Messages (@narumitw 风格)

```typescript
// goal/index.ts 新增
buildContinuationMessage(): string | undefined {
  const g = currentGoal;
  if (!g || g.status !== "active") return undefined;
  
  return [
    `Continue working on the goal.`,
    `Objective: ${g.objective}`,
    `Turns: ${g.turnsUsed}, Tokens: ${g.tokensUsed}`,
  ].join("\n");
}

// index.ts 中调用
pi.on("context", (event, ctx) => {
  const continuation = goalManager.buildContinuationMessage();
  if (continuation) {
    // 注入到 context
  }
});
```

### 7. Widget Goal 状态显示

```typescript
// widget.ts 新增
function buildGoalStatus(goal: GoalSnapshot | null): string {
  if (!goal) return "";
  const badge = goal.status === "active" ? "●" :
                goal.status === "paused" ? "○" :
                goal.status === "blocked" ? "◆" : "✓";
  return `${badge} ${goal.objective.slice(0, 30)}`;
}
```

### 8. Goal 完成统计

```typescript
// goal/index.ts 新增
formatCompletionStats(): string | undefined {
  const g = currentGoal;
  if (!g || g.status !== "complete") return undefined;
  
  return [
    `Goal completed: ${g.objective}`,
    `Turns: ${g.turnsUsed}`,
    `Tokens: ${g.tokensUsed}`,
    `Time: ${Math.round(g.wallClockMs / 60000)}min`,
  ].join("\n");
}
```

## 代码量估算

| 优先级 | 任务数 | 新增代码 | 删除代码 | 净增 |
|--------|--------|---------|---------|------|
| 🔴 高 | 4 | ~115行 | -266行 | -151行 |
| 🟡 中 | 4 | ~120行 | 0 | +120行 |
| 🟢 低 | 4 | ~280行 | 0 | +280行 |
| **总计** | **12** | **~515行** | **-266行** | **+249行** |

## 时间估算

| 优先级 | 预计时间 |
|--------|---------|
| 🔴 高 | 1-2 小时 |
| 🟡 中 | 2-3 小时 |
| 🟢 低 | 4-5 小时 |
| **总计** | **7-10 小时** |

## 验证计划

### 单元测试
- Goal 生命周期测试
- Budget 检测测试
- Queue 操作测试
- Tool 阻止测试

### 集成测试
- Swarm + Goal 交互
- Context 注入测试
- Recovery 测试

### 手动测试
- /goal 命令测试
- Goal 工具测试
- Queue 操作测试
- Budget 检查测试

## 依赖关系

```
1. 删除旧 goal.ts (无依赖)
    ↓
2. pauseOnInterrupt (无依赖)
    ↓
3. Goal Queue Auto-switch (依赖 goal/queue.ts)
    ↓
4. /goal prioritize/drop/skip (依赖 goal/queue.ts)
    ↓
5. Stale Tool Blocking (依赖 goal/types.ts)
    ↓
6. Continuation Messages (依赖 goal/index.ts)
    ↓
7. Widget Goal 状态显示 (依赖 goal/types.ts)
    ↓
8. Goal 完成统计 (依赖 goal/index.ts)
    ↓
9-12. Recovery/Compaction/Forking (独立)
```

## 建议执行顺序

```
今天: 1 + 2 + 3 + 4 (高优先级)
明天: 5 + 6 + 7 + 8 (中优先级)
后续: 9 + 10 + 11 + 12 (低优先级)
```
