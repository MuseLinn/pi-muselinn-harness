# 模型路由与交互式 Workflow 优化方案

## 核心思路

这是一个**工具设计 + prompt 工程**问题。模型已拥有：
- `agent_swarm` 工具（含 `model`、`model_map`、`model_tier` 参数）
- `ask_user_question` 工具（已安装的 rpiv 扩展）
- 自动路由 `resolveModelForTask()`（当前模型+200，defaultProvider+100，多模态+200 等评分）

关键是如何**描述给模型的规则**让它做出正确决策。

## Phase 1: 更新工具描述（最小改动，最大效果）

只更新 `agent_swarm` 和 `agent` 工具的 `promptGuidelines`，让模型理解路由能力并自主决策。

```typescript
promptGuidelines: [
  "Model routing: if you don't specify 'model', the system auto-selects the best model based on: task type (simple/complex/multimodal), current session model, default provider, and model capabilities.",
  "If the user mentions specific models by name (e.g., 'use deepseek'), pass them via 'model' or 'model_map'.",
  "For multi-model swarms, use model_map to assign different models per item (e.g., 0:'kimi', 1:'mimo').",
  "If you're unsure which model is best, call ask_user_question to let the user choose — then pass the result as model/model_map.",
]
```

## Phase 2: 优化 ctx.ui.select() 展示

在 `resolveModelForTask()` 中，当评分接近时显示的模型选择框：
- 推荐选项放在最前面
- 展示更丰富的模型信息（provider、context window、特殊能力）
- 默认回车使用推荐模型

## Phase 3: ask_user_question 集成指南

在 promptGuidelines 中加入模型不确定时的决策链路：
```
不确定用哪个模型？
  ↓
分析任务（简单→免费模型，复杂→高质量，图片→多模态）
  ↓
有明确最佳模型？→ 自动选
  ↓
不确定？→ ask_user_question 让用户选
  ↓
用户回答中提到了具体模型？→ 用 model_map 分配
```

## Phase 4: Multi-model workflow 支持

模型能根据任务自动分配不同模型：
- 审查任务用高质量模型
- 搜索任务用快速模型
- 图片任务用多模态模型
