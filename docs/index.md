---
layout: default
title: pi-muselinn-harness
---

<div class="hero reveal">
  <img class="hero-logo" src="assets/img/logo-animated.svg" alt="MuseLinn logo — dots igniting into an M">
  <h1><span data-l="en">Pi skips sub-agents and plan mode.<br><em>This harness builds them.</em></span><span data-l="zh">Pi 刻意不做子代理和计划模式。<br><em>这个 harness 把它们全部补上。</em></span></h1>
  <p class="sub"><span data-l="en">Kimi Code-style agent orchestration for the <a href="https://pi.dev">Pi coding agent</a> —<br>swarm, goal, plan, permission, task, hooks, skills, and a boxed-editor TUI, in one coherent package.</span><span data-l="zh">为 <a href="https://pi.dev">Pi coding agent</a> 打造的 Kimi Code 风格编排套件 —<br>Swarm、Goal、Plan、Permission、Task、Hooks、Skills 与闭合框编辑器,一个包全部集成。</span></p>
  <div class="installbar">
    <span><span class="prompt">$</span>pi install npm:pi-muselinn-harness</span>
    <span class="hint">npm</span>
  </div>
</div>

<div class="split" id="split">
  <div class="split-term">
    <div class="demo-term" id="demo-term">
      <div class="termtitle" id="demo-title">swarm · live</div>
      <div id="demo-body"><span class="scroll-cue"><span class="prompt">$</span>scroll to continue<span class="cue-caret">▍</span></span></div>
    </div>
  </div>
  <div class="split-sections">
    <section class="split-section" data-scene="swarm">
      <h3><span data-l="en">⬒ <em>Swarm</em> — real parallelism</span><span data-l="zh">⬒ <em>Swarm</em> — 真正的并行</span></h3>
      <p data-l="en">Concurrent subagents with a live braille-grid TUI. Real <code>max_concurrency</code> worker pool, progressive launch, 30-min timeouts, two-step <code>/cancel</code>, <code>/resume</code>, and a three-pane task browser (<code>ctrl+shift+t</code>).</p>
      <p data-l="zh">盲文网格实时展示并行子代理。真实 <code>max_concurrency</code> worker 池、渐进投放、30 分钟超时、两步 <code>/cancel</code>、<code>/resume</code>,以及三栏任务浏览器(<code>ctrl+shift+t</code>)。</p>
    </section>
    <section class="split-section" data-scene="goal">
      <h3><span data-l="en">◎ <em>Goal</em> — finish what you start</span><span data-l="zh">◎ <em>Goal</em> — 有始有终</span></h3>
      <p data-l="en"><code>/goal</code> lifecycle with budgets (turns / tokens / wall-clock), a 3-turn blocked circuit breaker, a completion-criterion gate, FIFO queue, and session persistence.</p>
      <p data-l="zh"><code>/goal</code> 目标生命周期:预算(轮次/token/墙钟)、连续 3 轮阻断熔断、完成判据门禁、FIFO 队列、会话级持久化。</p>
    </section>
    <section class="split-section" data-scene="plan">
      <h3><span data-l="en">✎ <em>Plan</em> — read-only first</span><span data-l="zh">✎ <em>Plan</em> — 先谋后动</span></h3>
      <p data-l="en">The LLM explores and writes a plan; execution waits for your approval. Kimi Code permission model — bash follows normal permission mode (auto/yolo/manual), only Write/Edit (outside plan file), TaskStop, Cron are blocked. Plan file accepts exact path, <code>local://</code> basename, and resolved absolute path. <code>plan</code> badge on the editor border while active.</p>
      <p data-l="zh">LLM 先探索代码库、写计划,审批后才执行。Kimi Code 权限模型——bash 走正常 permission mode（auto/yolo/manual），只拦截 Write/Edit（非 plan 文件）、TaskStop、Cron。Plan 文件支持精确路径、<code>local://</code> 文件名、解析绝对路径三种匹配。激活时编辑器上边框显示 <code>plan</code> 徽标。</p>
    </section>
    <section class="split-section" data-scene="permission">
      <h3><span data-l="en">⛨ <em>Permission</em> — safety before speed</span><span data-l="zh">⛨ <em>Permission</em> — 安全先于效率</span></h3>
      <p data-l="en">An 18-level policy chain across <code>auto</code> / <code>yolo</code> / <code>manual</code>. Destructive commands always ask; <code>.env</code> / <code>id_rsa</code> never pass — even in auto mode. Plus background tasks and cron.</p>
      <p data-l="zh">18 级策略链,贯穿 <code>auto</code> / <code>yolo</code> / <code>manual</code>。破坏性命令每次必问,<code>.env</code> / <code>id_rsa</code> 永不放行——auto 模式也不例外。另有后台任务与 cron 定时。</p>
    </section>
    <section class="split-section" data-scene="hooks">
      <h3><span data-l="en">⚡ <em>Hooks</em> — every lifecycle event</span><span data-l="zh">⚡ <em>Hooks</em> — 全生命周期事件</span></h3>
      <p data-l="en">Kimi Code-aligned <code>[[hooks]]</code> engine: 16 events, blockable <code>PreToolUse</code> / <code>Stop</code> / <code>UserPromptSubmit</code>, exit-code semantics, fail-open. Skills scanned across seven scopes, collision-free.</p>
      <p data-l="zh">对齐 Kimi Code 的 <code>[[hooks]]</code> 引擎:16 个事件、可阻断的 <code>PreToolUse</code> / <code>Stop</code> / <code>UserPromptSubmit</code>、退出码语义、fail-open。Skills 七级作用域扫描,零冲突。</p>
    </section>
    <section class="split-section" data-scene="tui">
      <h3><span data-l="en">▭ <em>TUI</em> — the boxed editor</span><span data-l="zh">▭ <em>TUI</em> — 闭合框编辑器</span></h3>
      <p data-l="en">Kimi-style closed box (<code>╭─╮ │ ╰─╯</code>) with spinner and working state in the top border, three styles, hot-switch with <code>/tui</code>, and a render timing probe.</p>
      <p data-l="zh">Kimi 式闭合框(<code>╭─╮ │ ╰─╯</code>),上边框嵌入 spinner 与工作状态,三种样式,<code>/tui</code> 热切换,内置渲染耗时探针。</p>
    </section>
  </div>
</div>

<h2><span data-l="en">New in 0.9.0</span><span data-l="zh">0.9.0 新功能</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">TODO Phase Model</span><span data-l="zh">TODO Phase Model — 分阶段管理</span>
<span data-l="en">The todo system is rewritten with oh-my-pi-style phases: <code>TodoPhase</code> with per-task status (<code>pending</code>/<code>in_progress</code>/<code>completed</code>/<code>abandoned</code>), 7 ops, auto-promote, roman-numeral phase tree (<code>Ⅰ. Scanner · 2/4</code>) with collapse/expand, a reminder system that injects pending todos when the agent stops, and Markdown round-trip for <code>/todo export/import</code>.</span><span data-l="zh">Todo 系统全面重写为 oh-my-pi 风格阶段模型：<code>TodoPhase</code> 管理任务状态（<code>pending</code>/<code>in_progress</code>/<code>completed</code>/<code>abandoned</code>），7 种操作，自动 promote，罗马数字阶段树（<code>Ⅰ. Scanner · 2/4</code>）支持折叠展开，agent 停下时未完成 todo 自动注入提醒，支持 <code>/todo export/import</code> Markdown 双向导出。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Plan Mode — Kimi Code Permission Model</span><span data-l="zh">Plan Mode — 对齐 Kimi Code 权限模型</span>
<span data-l="en">Plan mode no longer maintains its own bash command whitelist. Bash follows the normal permission mode (auto/yolo/manual) — the same design as Kimi Code. Only Write/Edit (outside plan file), TaskStop, and CronCreate/CronDelete are blocked. The plan file path is matched by exact path, <code>local://</code> basename, and resolved absolute path under <code>sessionDir/plans/</code>.</span><span data-l="zh">Plan mode 不再维护自己的 bash 命令白名单。bash 遵循正常的 permission mode（auto/yolo/manual）——与 Kimi Code 设计一致。只拦截 Write/Edit（非 plan 文件）、TaskStop 和 CronCreate/CronDelete。Plan 文件路径支持精确路径、<code>local://</code> 文件名匹配和 <code>sessionDir/plans/</code> 下的解析绝对路径三种方式。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">No more "stuck in plan mode"</span><span data-l="zh">不再「卡在 plan mode」</span>
<span data-l="en"><code>cd</code> and other common commands were blocked by the bash whitelist. <code>local://</code> plan writes were rejected by the path guard. Both are fixed: bash passes through to the permission chain, and plan writes accept <code>local://</code> via basename matching.</span><span data-l="zh">以前 <code>cd</code> 等常见命令被 bash 白名单拦截，<code>local://</code> 写 plan 被路径守卫拒绝。现在两者都已修复：bash 放行到 permission chain，plan 写支持 <code>local://</code> 文件名匹配。</span>
</div>
</div>

<h2><span data-l="en">New in 0.8.2</span><span data-l="zh">0.8.2 新功能</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">Custom Agent Files</span><span data-l="zh">自定义 Agent 文件</span>
<span data-l="en">Define agent profiles as Markdown files with YAML frontmatter — <code>name</code>, <code>description</code>, <code>tools</code>/<code>disallowedTools</code>, <code>subagents</code>, and a system prompt template with <code>${base_prompt}</code> support. Discovered from <code>.pi/agents/</code>, <code>.kimi-code/agents/</code>, and <code>.agents/agents/</code>. Use <code>agent_file_list</code> to browse, and pass <code>agent_file</code> to <code>agent</code> or <code>agent_swarm</code>.</span><span data-l="zh">用 Markdown 文件 + YAML frontmatter 定义 agent 配置文件——<code>name</code>、<code>description</code>、<code>tools</code>/<code>disallowedTools</code>、<code>subagents</code>，支持 <code>${base_prompt}</code> 占位符。自动从 <code>.pi/agents/</code>、<code>.kimi-code/agents/</code>、<code>.agents/agents/</code> 发现。<code>agent_file_list</code> 浏览，<code>agent</code>/<code>agent_swarm</code> 传 <code>agent_file</code> 即可加载。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Tool Gating</span><span data-l="zh">工具门控</span>
<span data-l="en">Three-layer tool policy (Profile → Session runtime) integrated into the 18-level permission chain. Agent file profiles can restrict which tools a subagent may use. The gate is checked before any policy rule runs.</span><span data-l="zh">三层工具策略（Profile → Session 运行时）集成到 18 级权限链。Agent 文件可以限制子代理能用的工具。门控在权限规则之前执行。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Agent Lifecycle</span><span data-l="zh">Agent 生命周期</span>
<span data-l="en"><code>agent.created</code> / <code>agent.disposed</code> events emitted by every subagent run. Active agent count shown in the status bar — just like Kimi Code's <code>[3 agents running]</code>.</span><span data-l="zh">子代理运行时会触发 <code>agent.created</code> / <code>agent.disposed</code> 事件。状态栏实时显示活动 agent 数量——和 Kimi Code 的 <code>[3 agents running]</code> 一样的体验。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Permission &amp; Plan Mode Alignment</span><span data-l="zh">权限与 Plan 模式对齐</span>
<span data-l="en">Policy chain reordered: Auto mode is truly automatic (no dialogs), YOLO still guards destructive/sensitive ops. Plan mode blocks <code>task_stop</code>/<code>cron_create</code>/<code>cron_delete</code>. Sparse/full injection variants reduce prompt bloat. Auto ExitPlanMode warns <em>"user has NOT explicitly approved"</em>.</span><span data-l="zh">策略链重排：Auto 模式真正全自动（无对话框），YOLO 仍保护破坏性/敏感操作。Plan 模式阻断 <code>task_stop</code>/<code>cron_create</code>/<code>cron_delete</code>。Full/Sparse 注入变体减少 prompt 膨胀。Auto 模式 ExitPlanMode 输出 <em>"user has NOT explicitly approved"</em> 警告。</span>
</div>
</div>

<h2><span data-l="en">New in 0.7.9</span><span data-l="zh">0.7.9 新功能</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">Revise feedback input</span><span data-l="zh">Revise 反馈输入</span>
<span data-l="en">Plan approval's <strong>Revise</strong> now opens a text input dialog before returning to plan mode. Your revision feedback is persisted into <code>PlanData.revisionFeedback</code> and injected into the plan-mode system prompt — the model sees exactly what you want changed, every time.</span><span data-l="zh">Plan 审批的 <strong>Revise</strong> 现在先弹文本输入框，再回到 plan mode。你的修改意见持久化到 <code>PlanData.revisionFeedback</code> 并注入 plan mode system prompt——模型每次都清楚地知道你要改什么。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Same plan, now with direction</span><span data-l="zh">同一计划，有方向地改</span>
<span data-l="en"><code>reenterForRevision(feedback)</code> keeps the same plan id/path/content while injecting user feedback. Three files changed: <code>types.ts</code>, <code>index.ts</code>, <code>tools.ts</code>. All 19 suites, 580+ assertions — green.</span><span data-l="zh"><code>reenterForRevision(feedback)</code> 保留同一 plan id/path/content，同时注入用户反馈。改了三个文件：<code>types.ts</code>、<code>index.ts</code>、<code>tools.ts</code>。全部 19 套件、580+ 断言——全绿。</span>
</div>
</div>

<h2><span data-l="en">New in 0.7.8</span><span data-l="zh">0.7.8 新功能</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">Background tasks, fixed at the root</span><span data-l="zh">后台任务，从根上修好</span>
<span data-l="en">Two root causes behind broken tasks on pi ≥ 0.81: <code>run_background</code> died at spawn because the subagent loader omitted <code>LoadExtensionsResult.runtime</code> (<code>createAgentSession</code> threw — empty <code>task_output</code>, <code>block:true</code> returning instantly); and <code>task_list</code> crashed on restored entries whose text lived in <code>description</code>, not <code>prompt</code>. Both fixed — runtime included (0.80-compatible), <code>description → prompt</code> mapped, and failed tasks now surface <code>[task failed: …]</code>.</span><span data-l="zh">pi ≥ 0.81 上任务失效的两个根因：<code>run_background</code> 因子代理 loader 缺少 <code>LoadExtensionsResult.runtime</code> 在 spawn 即抛错（<code>task_output</code> 为空、<code>block:true</code> 立即返回）；<code>task_list</code> 对文本存在 <code>description</code> 而非 <code>prompt</code> 的恢复 entry 直接崩溃。现已双修复——loader 携带 runtime（兼容 0.80）、<code>description → prompt</code> 映射，失败任务显示 <code>[task failed: …]</code>。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Plan persistence dedup</span><span data-l="zh">Plan 持久化去重</span>
<span data-l="en"><code>PlanManager.persist()</code> no longer appends duplicate entries (observed: 5 identical <code>muselinn_plan</code> entries within 25 s) — a serialized state identical to the last persisted one is skipped, and restore seeds the dedup baseline.</span><span data-l="zh"><code>PlanManager.persist()</code> 不再追加重复 entry（实测 25 秒内 5 条相同 <code>muselinn_plan</code>）——与上次持久化内容相同的序列化状态直接跳过，restore 时播种去重基线。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Regression-locked</span><span data-l="zh">回归锁定</span>
<span data-l="en">New <code>task.test.mjs</code> suite (16 checks): restore prompt defaulting, prompt-less list rendering, <code>block:true</code> waiting, failed-task surfacing, loader runtime shape. 19 suites, 580 assertions — all green in CI.</span><span data-l="zh">新增 <code>task.test.mjs</code> 套件（16 项）：恢复 prompt 兜底、无 prompt 列表渲染、<code>block:true</code> 等待、失败任务报错、loader runtime 结构。共 19 个套件、580 项断言，CI 全绿。</span>
</div>
</div>

<h2><span data-l="en">Previously — 0.7.7</span><span data-l="zh">此前 — 0.7.7</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">Plan &amp; Goal, de-glitch’d</span><span data-l="zh">Plan 与 Goal 除颤</span>
<span data-l="en">Plan mode: the bash gate vets <code>rtk</code>-wrapped commands, Revise keeps the same plan object, and stale restored plans deactivate instead of trapping the session. Goal: badge counters restore monotonically (no more flicker), completed goals stay completed, and the <code>verified=true</code> completion rule is documented in the tool itself.</span><span data-l="zh">Plan 模式：bash 门禁识别 <code>rtk</code> 包装命令，Revise 保留同一 plan 对象，过期恢复的 plan 自动停用而不是困住会话。Goal：徽标计数单调恢复（不再闪烁），完成的目标不会复活，<code>verified=true</code> 完成规则写进了工具描述。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Ask dialog robustness</span><span data-l="zh">Ask 对话框健壮性</span>
<span data-l="en">The tabbed multi-question dialog (multi-select + free-text Other) grows up: long option lists scroll in a bounded window, duplicate answers are deduplicated, and background tasks can ask questions without wedging the UI.</span><span data-l="zh">标签页多题对话框（多选 + Other 自由文本）走向成熟：超长选项列表在有界窗口内滚动，重复答案自动去重，后台任务也能发起提问而不卡死 UI。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">CI/CD on GitHub Actions</span><span data-l="zh">GitHub Actions CI/CD</span>
<span data-l="en">Every push and PR runs the full test matrix (ubuntu + windows × node 20/22, 19 suites, 580 assertions). Tag <code>v*</code> and the same matrix gates an automatic npm publish.</span><span data-l="zh">每次 push 与 PR 运行完整测试矩阵（ubuntu + windows × node 20/22，19 个套件，580 项断言）。打 <code>v*</code> tag 即由同一矩阵门禁触发 npm 自动发布。</span>
</div>
</div>

<h2><span data-l="en">Earlier — 0.7.4 / 0.7.5</span><span data-l="zh">更早 — 0.7.4 / 0.7.5</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">Native companion tools</span><span data-l="zh">原生伴随工具</span>
<span data-l="en"><code>ask_user_question</code> dialog and <code>todo_list</code> + inline panel (<code>alt+t</code>) are now built in — no external rpiv packages needed. Approval panel with per-tool titles and reject-with-reason for the manual tier.</span><span data-l="zh"><code>ask_user_question</code> 问卷对话框与 <code>todo_list</code> + 内联面板（<code>alt+t</code>）已原生内置——不再需要外部 rpiv 包。manual 档审批面板：分工具标题、拒绝可填理由。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Safer by default</span><span data-l="zh">默认更安全</span>
<span data-l="en">Swarm permission gating with <code>/mode</code> broadcast, subagent resume guard, oversized tool results truncated to disk with <code>output_path</code>, and no-UI permission blocks that state NOT-executed explicitly.</span><span data-l="zh">swarm 权限门控（<code>/mode</code> 广播）、子代理 resume 守卫、超大工具结果落盘留 <code>output_path</code>，无 UI 时权限阻断明确告知"未执行"。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">pi 0.81 ready</span><span data-l="zh">已兼容 pi 0.81</span>
<span data-l="en">Verified against pi 0.81.x. Upgrading? Remove the old companion extensions (<code>rpiv-ask-user-question</code>, <code>rpiv-todo</code>) — the built-in tools replace them.</span><span data-l="zh">已验证兼容 pi 0.81.x。升级注意：请移除旧的伴随扩展（<code>rpiv-ask-user-question</code>、<code>rpiv-todo</code>）——内置工具已替代它们。</span>
</div>
</div>

<style>.beta-badge{display:inline-block;font-family:var(--mono);font-size:.62rem;letter-spacing:.06em;padding:.12rem .5rem;border-radius:4px;border:1px solid var(--accent2);color:var(--accent2);vertical-align:middle;margin-left:.5rem;line-height:1.4}</style>

<h2><span data-l="en">MusePi — the fork</span><span data-l="zh">MusePi — 我们的 fork</span> <span class="beta-badge">BETA</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">What it is</span><span data-l="zh">是什么</span>
<span data-l="en">MusePi is our pi fork where the main-line development happens — everything in this harness, native: hash-anchored editing (hashline), per-role model routing, lazy LSP with write-through diagnostics, and progressive tool disclosure for Kimi K3.</span><span data-l="zh">MusePi 是我们的 pi fork，主线开发所在——本 harness 能力的原生形态：哈希锚定编辑（hashline）、分角色模型路由、LSP 懒加载与写后诊断回灌、K3 动态工具加载。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Why a fork</span><span data-l="zh">为什么 fork</span>
<span data-l="en">Some things extensions can't do: swarm subagents running in auto-created git worktrees (merged back on completion), deterministic zero-LLM compaction (snapcompact), a Markdown memory system with BM25 recall, and terminal notifications.</span><span data-l="zh">有些事扩展做不到：swarm 子代理自动 git worktree 隔离（完成自动合并回写）、零 LLM 调用的确定性压缩（snapcompact）、Markdown 记忆系统（BM25 召回）、终端通知。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Relationship</span><span data-l="zh">两者关系</span>
<span data-l="en">The harness stays maintained — bug fixes, pi compatibility, and features that fit the extension form. MusePi gets the capabilities that need core changes. Same core logic, two delivery vehicles.</span><span data-l="zh">harness 持续维护——bug 修复、pi 兼容、适合扩展形态的功能照加。需要改核心的能力进 MusePi。同一套 core 逻辑，两个交付载体。</span>
</div>
</div>

<h2><span data-l="en">What's next</span><span data-l="zh">下一步</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">Advisor &amp; i18n</span><span data-l="zh">顾问与 i18n</span>
<span data-l="en">Advisor side-review model on top of the model-roles table; native bilingual UI (English/Chinese) for MusePi — docs and this page are already bilingual (toggle in the nav).</span><span data-l="zh">基于模型角色表的 advisor 旁路评审；MusePi 原生双语界面（中/英）——文档与本页面已双语（导航栏切换）。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Memory v2</span><span data-l="zh">记忆系统 v2</span>
<span data-l="en"><code>/dream</code> distillation across sessions and a checkpoint-writer that works with compaction — building on the W5 memory store.</span><span data-l="zh">跨会话 <code>/dream</code> 蒸馏、与压缩联动的 checkpoint-writer——在 W5 记忆存储之上。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Native approval panel</span><span data-l="zh">审批面板原生化</span>
<span data-l="en">A native approval dialog in MusePi consuming the clustered-diff renderer, completing what the extension's panel started.</span><span data-l="zh">MusePi 原生审批对话框，消费 clustered diff 渲染器，完成扩展版审批面板的未竟之路。</span>
</div>
</div>

<h2><span data-l="en">Commands</span><span data-l="zh">命令</span></h2>

```
/swarm on|off        /cancel      /resume       /tasks (ctrl+shift+t)
/goal <objective>    /goal pause|resume|cancel|replace|budget|queue
/plan [on|off|clear] /mode        /tui style plain|boxed|compact
```

<span data-l="en">All commands support Tab completion for subcommands and arguments.</span><span data-l="zh">所有命令均支持 Tab 子命令/参数补全。</span>

<h2><span data-l="en">Links</span><span data-l="zh">链接</span></h2>

- [GitHub](https://github.com/MuseLinn/pi-muselinn-harness) · [npm](https://www.npmjs.com/package/pi-muselinn-harness) · [pi.dev catalog](https://pi.dev/packages)
- [English README](https://github.com/MuseLinn/pi-muselinn-harness/blob/main/README.md) · [中文文档](https://github.com/MuseLinn/pi-muselinn-harness/blob/main/README.zh-CN.md)
- License: MIT
