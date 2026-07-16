# pi-muselinn-harness 技术文档

## 架构概览

```
pi-muselinn-harness/          (2900行, 11个文件)
├── index.ts          (785行)  入口：注册 3 个工具 + 6 个命令
├── types.ts          (141行)  类型定义 + 全局状态 + Goal 类型
├── helpers.ts        (194行)  盲文进度条 + 网格布局
├── widget.ts         (163行)  TUI 组件 (80ms tick 动画)
├── subagent.ts       (355行)  子代理执行 + UserCancellationError
├── goal.ts           (237行)  GoalManager (lifecycle + budget + GoalActor)
├── commands.ts       (402行)  /swarm /cancel /resume /goal /tasks /swarm-status
├── task-browser.ts   (562行)  Kimi Code 式三栏任务浏览器
├── report.ts          (53行)  Markdown 报告格式化
├── state.ts            (8行)  swarmEnabled 开关
└── package.json          -    扩展配置

外部依赖:
├── rpiv-ask-user-question   交互式问卷 (ask_user_question)
└── rpiv-todo                任务管理 (todo)
```

## 功能清单

### 1. 子代理执行 (agent_swarm / agent)

**工具参数**:
```typescript
agent_swarm({
  description: string,           // Swarm 名称
  subagent_type: "explore" | "plan" | "coder",
  prompt_template: string,       // 模板，支持 {{item}}
  items: string[],               // 处理项
  model_tier?: "cheap" | "balanced" | "premium" | "auto",
  model?: string,                // 可选：指定模型 (支持别名)
  model_map?: Record<string, string>,  // 可选：每个 item 指定不同模型
  max_concurrency?: number,      // 最大并发数 (默认 8)
})
```

**核心实现**:
- `createAgentSession()` in-process 执行 (非子进程)
- 并发控制 `runParallel()` + 指数退避 `retryOnRateLimit()`
- 任务报告 `formatReport()`

### 2. 模型路由 (智能自动)

**完全自动发现** - 不需要硬编码别名:
```typescript
// 从 ctx.modelRegistry.getAvailable() 读取所有模型
const available = ctx.modelRegistry.getAvailable();

// 1. 用户指定 model: "deepseek"
//    → 搜索 registry 中含 "deepseek" 的模型
//    → 评分: defaultProvider +100, free +50, 长度-分
//    → 选最高分

// 2. 不指定 → 分析任务类型
const prompt = params.prompt_template.toLowerCase();
const hasImages = items.some(i => /\.(png|jpg|gif|webp)$/i.test(i));
const isSimple = /\b(find|list|scan|grep)\b/.test(prompt);
const isComplex = /\b(implement|refactor|design)\b/.test(prompt);

// 评分:
// 图片任务 → 多模态模型 +200
// 简单任务 → 免费模型 +150
// 复杂任务 → 大上下文 +100

// 3. 候选接近 → ctx.ui.select() 问用户
if (top2 分数差 < 20) {
  const choice = await ctx.ui.select("Which model?", options);
}
```

**模型信息** (从 Model 接口获取):
- `id`: 模型 ID
- `provider`: 供应商 (opencode, opencode-go, xiaomi, kimi-coding 等)
- `input`: ["text" | "image"] (文本/多模态)
- `cost`: 价格 (per token)
- `contextWindow`: 上下文窗口
- `reasoning`: 推理能力

**用户指定**:
```typescript
agent_swarm(model: "kimi")                    // 自动搜索 "kimi" 相关模型
agent_swarm(model: "opencode:deepseek-v4-flash-free")  // 指定供应商+模型
agent_swarm(model_map: {"0": "kimi", "1": "mimo"})     // 每个 item 不同模型
```

### 3. Goal 系统 (Kimi Code 风格)

**生命周期**:
```
active → paused (用户暂停)
active → blocked (预算耗尽)
paused → active (用户恢复)
active → complete (完成)
任何状态 → clear (丢弃)
```

**命令**:
```
/goal                     → 显示当前目标
/goal <objective>         → 创建/替换目标
/goal pause               → 暂停
/goal resume              → 恢复
/goal cancel              → 丢弃
/goal replace <new>       → 替换目标语句
/goal next                → 标记当前步骤完成
```

**工具 (模型可调用)**:
```typescript
create_goal(objective, completion_criterion?, budgetLimits?)
get_goal()               → 返回当前目标状态
update_goal(status?, objective?, reason?)
```

**GoalActor 追踪**:
- `user` - 用户通过 /goal 命令
- `model` - 模型通过 create_goal/update_goal 工具
- `runtime` - 预算超限时自动 block
- `system` - 系统恢复

**Budget 追踪**:
```typescript
// turn_end 事件中记录
pi.on("turn_end", (event, ctx) => {
  const msg = event.message;
  if (msg.role === "assistant" && msg.usage) {
    const tokens = msg.usage.input + msg.usage.output;
    const { crossedBudget } = goalManager.recordTurn(tokens);
    if (crossedBudget) {
      ctx.ui.notify("Goal budget exceeded", "warning");
    }
  }
});
```

**Context 注入** (每次 LLM 调用前):
```typescript
pi.on("context", (event, ctx) => {
  goalManager.injectIntoMessages(event.messages);
  // 注入到 system message:
  // ─────────────────────
  // There is an active goal, with X tokens used, Y turns taken.
  // 
  // <untrusted_objective>
  // 实现登录功能
  // </untrusted_objective>
  //
  // Budget: ↑12k/50k (24% used)
  // ─────────────────────
});
```

### 4. Cancel 改进

**UserCancellationError**:
```typescript
class UserCancellationError extends Error {
  userCancelled = true;  // 区分用户取消 vs 系统错误
}
```

**AbortSignal 链**:
```typescript
function linkAbortSignal(source: AbortSignal, target: AbortController) {
  source.addEventListener("abort", () => {
    target.abort(source.reason || userCancellationReason());
  });
}
```

**全局 AbortController**:
```typescript
// /cancel 时
globalAbortController.abort(new UserCancellationError());
// 所有子 session 通过 linkAbortSignal 接收取消信号
```

### 5. Resume 改进

**resume_agent_ids** (支持恢复特定 agent):
```typescript
agent_swarm({
  items: ["remaining-item"],
  resume_agent_ids: {
    "001": "新 prompt for agent 001"  // 恢复特定 agent，给新 prompt
  }
})
```

### 6. Question 对话框 (rpiv-ask-user-question)

**rpiv 版本** (已集成):
- `ask_user_question` 工具
- 多问题 Tab 导航
- Preview pane (side-by-side)
- Per-option notes (按 n)
- Overflow scroll
- Chat row ("Chat about this")
- Localized UI

### 7. 网格动画 (Kimi Code 风格)

**Tick 驱动**:
```typescript
// 80ms 帧率
incrementTicks(tasks, nowMs)  // running/pending 每帧 +1

// 盲文渲染
accumulatedBrailleBar(ticks, width, phase)
  cycleSize = width × 7 (braille levels)
  completedCycles = floor(ticks / cycleSize)  // 满圈→分隔符
  cycleTicks = ticks % cycleSize
  activeCells = ceil(cycleTicks / 7)

// 完成动画 (360ms)
completedDisplayTicks(ticks, width, elapsed)
  fillProgress = elapsed / 360
  displayTicks = ticks + (full - ticks) × fillProgress
```

**自动布局**:
```typescript
calculateGridLayout(count, availableWidth, availableHeight)
  // 自动计算列数、行数、单元格宽度、进度条宽度
  // 文本模式优先，放不下→紧凑模式
```

### 8. 其他功能

**三栏任务浏览器** (`/tasks`):
- 左栏: 任务列表 + 选中高亮
- 右上: 任务详情
- 右下: 预览输出
- 键盘导航: ↑↓ Tab R S Enter Esc

**Swarm 状态栏**:
- 盲文进度条 (tick 驱动)
- 分段 pip 显示 (completed/working/queued/failed)
- 目标状态显示

## Pi API 使用

### ExtensionAPI 事件
- `pi.on("session_start", ...)` - 恢复 goal + 设置状态栏
- `pi.on("context", ...)` - 注入 goal 到 system prompt
- `pi.on("turn_end", ...)` - 记录 token 用量 + budget 检查

### ExtensionAPI 方法
- `pi.registerTool()` - 注册 agent_swarm, agent, create_goal, get_goal, update_goal
- `pi.registerCommand()` - 注册 /swarm, /cancel, /resume, /goal, /tasks, /swarm-status
- `pi.appendEntry()` - 持久化 goal 到 session custom entries
- `pi.sendUserMessage()` - 发送消息给模型 (用于 /goal refine)
- `ctx.ui.select()` - 显示选择对话框 (用于模型确认)
- `ctx.ui.notify()` - 显示通知

### 子代理
- `createAgentSession()` - 创建 in-process 子会话
- `session.prompt()` - 执行 prompt
- `session.subscribe()` - 订阅事件
- `session.abort()` - 中止会话

## 待实现功能

1. **TaskOutputViewer** - Kimi Code 的完整任务输出查看器
2. **Proactive compaction** - Kimi Code 的主动压缩逻辑
3. **Recovery machine** - 恢复机制
4. **Goal budget 预算指引** - 注入剩余 token/turn 到 system prompt
