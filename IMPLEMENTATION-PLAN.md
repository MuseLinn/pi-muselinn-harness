# 实施计划：Goal 系统整合

## 核心策略

**以 `@narumitw/pi-goal` 为核心**，参考 `pi-codex-goal` 和 Kimi Code，补充可用特性。

## 架构设计

```
pi-muselinn-harness/
├── index.ts              入口：注册 swarm + goal 工具
├── goal/
│   ├── index.ts          GoalManager (核心逻辑)
│   ├── types.ts          类型定义
│   ├── commands.ts       /goal 命令
│   ├── tools.ts          goal 工具 (create/get/update)
│   ├── budget.ts         Budget Report 计算
│   ├── persistence.ts    持久化 (appendEntry)
│   └── queue.ts          Goal Queue (参考 @narumitw)
├── swarm/
│   ├── index.ts          SwarmManager
│   ├── subagent.ts       子代理执行
│   ├── commands.ts       /swarm /cancel /resume
│   └── widget.ts         TUI 组件
└── shared/
    ├── types.ts          共享类型
    └── state.ts          共享状态
```

## Phase 1：解耦 Goal 和 Swarm (优先级高)

**目标**：将 Goal 从 Swarm 中独立出来

### 1.1 创建 goal/ 目录结构
```
goal/
├── index.ts          GoalManager class
├── types.ts          GoalSnapshot, GoalStatus, GoalActor, GoalBudgetLimits
├── commands.ts       /goal 命令 (pause/resume/clear/edit/replace/next)
├── tools.ts          create_goal, get_goal, update_goal 工具
├── budget.ts         computeBudgetReport(), budgetBandGuidance()
├── persistence.ts    appendEntry + session_start 恢复
└── queue.ts          Goal Queue (参考 @narumitw)
```

### 1.2 迁移 Goal 逻辑
- 从 `goal.ts` 迁移到 `goal/index.ts`
- 从 `types.ts` 迁移 Goal 相关类型到 `goal/types.ts`
- 从 `commands.ts` 迁移 /goal 命令到 `goal/commands.ts`
- 从 `index.ts` 迁移 goal 工具到 `goal/tools.ts`

### 1.3 更新 Swarm 依赖
- Swarm 导入 `goal/` 模块而不是直接引用
- 保持松耦合

## Phase 2：补充 Goal 特性 (优先级高)

**目标**：从三个系统中提取可用特性

### 2.1 从 @narumitw/pi-goal 提取

| 特性 | 实现方式 | 代码量 |
|------|---------|--------|
| Goal Queue 队列 | 数组 + 自动切换 | ~80 行 |
| Ordered Queue | 优先级排序 | ~40 行 |
| usage_limited 状态 | 检测 429 错误 | ~20 行 |
| budget_limited 状态 | 检测 budget 超限 | ~20 行 |
| Stale Tool Blocking | 检测过期 tool call | ~30 行 |

### 2.2 从 pi-codex-goal 提取

| 特性 | 实现方式 | 代码量 |
|------|---------|--------|
| appendEntry 持久化 | pi.appendEntry() | ~30 行 |
| entry 重建 goal | session_start 扫描 | ~40 行 |
| Budget Limit Prompt | 注入到 context | ~20 行 |
| Provider Limit Auto-Resume | 检测 429 + 定时 resume | ~30 行 |

### 2.3 从 Kimi Code 提取

| 特性 | 实现方式 | 代码量 |
|------|---------|--------|
| Budget Report 计算 | computeBudgetReport() | ~40 行 |
| wallClockResumedAt | pause/resume 时更新 | ~20 行 |
| setBudgetLimits 方法 | GoalManager 方法 | ~15 行 |
| pauseOnInterrupt | signal.aborted 检测 | ~15 行 |
| incrementTurn | GoalManager 方法 | ~10 行 |
| recordTokenUsage | turn_end 事件调用 | ~15 行 |
| Normalization after replay | session_start 检查 | ~20 行 |

## Phase 3：Goal Queue 实现 (优先级中)

**目标**：参考 @narumitw 实现 Goal Queue

### 3.1 Queue 数据结构
```typescript
interface GoalQueueItem {
  id: string;
  objective: string;
  completionCriterion?: string;
  budgetLimits?: GoalBudgetLimits;
  status: "pending" | "active" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
}

interface GoalQueue {
  items: GoalQueueItem[];
  currentIndex: number;
  mode: "fifo" | "priority";
}
```

### 3.2 Queue 命令
```
/goal add <objective>        添加到队列
/goal queue                  显示队列
/goal prioritize <index>     提升优先级
/goal drop <index>           删除队列项
/goal skip                   跳过当前项
```

### 3.3 Queue 自动切换
- 当前 goal 完成后自动切换到下一个
- 支持 FIFO 和 Priority 两种模式

## Phase 4：Budget 系统完善 (优先级中)

**目标**：完整的 Budget 管理

### 4.1 Budget Report
```typescript
interface GoalBudgetReport {
  tokenBudget: number | null;
  turnBudget: number | null;
  wallClockBudgetMs: number | null;
  remainingTokens: number | null;
  remainingTurns: number | null;
  remainingWallClockMs: number | null;
  tokenBudgetReached: boolean;
  turnBudgetReached: boolean;
  wallClockBudgetReached: boolean;
  overBudget: boolean;
}
```

### 4.2 Budget Prompt 注入
```
Budget: ↑12k/50k (24% used, 38k remaining)
Turns: 3/10 (7 remaining)
Time: 2min/5min (3min remaining)
```

### 4.3 Budget 检查
- turn_end 事件中检查所有三种 budget
- 超限时自动 block goal
- 注入 budget 提示到 context

## Phase 5：Recovery 简化版 (优先级低)

**目标**：基础错误恢复

### 5.1 Context Overflow 处理
- 检测 error message 中的 "context" 关键词
- 自动 block goal
- 注入恢复提示

### 5.2 Provider Limit 处理
- 检测 429 错误
- 自动设置 usage_limited 状态
- 可选：定时 resume

### 5.3 Stale Tool Blocking
- 检测过期的 tool call
- 阻止过期 tool 执行
- 参考 @narumitw 的实现

## 代码量估算

| Phase | 新增代码 | 修改代码 | 总计 |
|-------|---------|---------|------|
| Phase 1 | ~200 行 | ~100 行 | ~300 行 |
| Phase 2 | ~250 行 | ~50 行 | ~300 行 |
| Phase 3 | ~200 行 | ~50 行 | ~250 行 |
| Phase 4 | ~100 行 | ~30 行 | ~130 行 |
| Phase 5 | ~100 行 | ~20 行 | ~120 行 |
| **总计** | ~850 行 | ~250 行 | ~1100 行 |

## 实施顺序

```
Phase 1: 解耦 (1-2 小时)
    ↓
Phase 2: 补充特性 (2-3 小时)
    ↓
Phase 3: Goal Queue (1-2 小时)
    ↓
Phase 4: Budget 完善 (1 小时)
    ↓
Phase 5: Recovery (1 小时)
```

**总计：6-9 小时**

## 依赖关系

```
Phase 1 (解耦)
    ↓
Phase 2 (特性)
    ├── 2.1 @narumitw 提取
    ├── 2.2 pi-codex-goal 提取
    └── 2.3 Kimi Code 提取
    ↓
Phase 3 (Queue) ← 依赖 Phase 2.1
    ↓
Phase 4 (Budget) ← 依赖 Phase 2.3
    ↓
Phase 5 (Recovery) ← 依赖 Phase 2.2
```

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| @narumitw 接口不稳定 | 高 | 只参考设计，不直接依赖 |
| pi-codex-goal 太复杂 | 中 | 只提取必要部分 |
| Kimi Code 特性不兼容 | 低 | 适配 Pi API |
| Goal Queue 实现复杂 | 中 | 先实现简单 FIFO |

## 验证计划

### 单元测试
- Goal 生命周期测试
- Budget 计算测试
- Queue 操作测试
- Persistence 测试

### 集成测试
- Swarm + Goal 交互测试
- Context 注入测试
- Recovery 测试

### 手动测试
- /goal 命令测试
- Goal 工具测试
- Queue 操作测试
- Budget 检查测试

## 清理计划

实现完成后：
1. 删除旧的 `goal.ts` (266 行)
2. 清理 `types.ts` 中的 Goal 相关类型
3. 清理 `commands.ts` 中的 /goal 命令
4. 清理 `index.ts` 中的 goal 工具
5. 更新 TECH-DOC.md
6. 卸载 pi-codex-goal (如果不再需要)
