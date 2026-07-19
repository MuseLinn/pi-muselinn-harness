---
layout: default
title: pi-muselinn-harness
---

<div class="hero reveal">
  <img class="hero-logo" src="assets/img/logo-animated.svg" alt="MuseLinn logo — dots igniting into an M">
  <h1><span data-l="en">Pi skips sub-agents and plan mode.<br><em>This harness builds them.</em></span><span data-l="zh">Pi 刻意不做子代理和计划模式。<br><em>这个 harness 把它们全部补上。</em></span></h1>
  <p class="sub"><span data-l="en">Kimi Code-style agent orchestration for the <a href="https://pi.dev">Pi coding agent</a> —<br>swarm, goal, plan, permission, task, hooks, skills, and a boxed-editor TUI, in one coherent package.</span><span data-l="zh">为 <a href="https://pi.dev">Pi coding agent</a> 打造的 Kimi Code 风格编排套件 —<br>Swarm、Goal、Plan、Permission、Task、Hooks、Skills 与闭合框编辑器,一个包全部集成。</span></p>
  <p class="badges">
    <a href="https://www.npmjs.com/package/pi-muselinn-harness"><img src="assets/img/badge-npm.png" alt="npm version"></a>
    <a href="https://github.com/MuseLinn/pi-muselinn-harness/blob/main/LICENSE"><img src="assets/img/badge-license.png" alt="license: MIT"></a>
    <a href="https://github.com/MuseLinn/pi-muselinn-harness#tests"><img src="assets/img/badge-tests.png" alt="tests: 269 assertions"></a>
  </p>
  <div class="installbar">
    <span><span class="prompt">$</span>pi install npm:pi-muselinn-harness</span>
    <span class="hint">npm</span>
  </div>
</div>

<div class="split" id="split">
  <div class="split-term">
    <div class="demo-term" id="demo-term">
      <div class="termtitle" id="demo-title">swarm · live</div>
      <div id="demo-body"></div>
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
      <p data-l="en">The LLM explores and writes a plan; execution waits for your approval. Read-only tool whitelist, plan-file path guard, and a <code>plan</code> badge on the editor border while active.</p>
      <p data-l="zh">LLM 先探索代码库、写计划,审批后才执行。只读工具白名单、plan 文件路径守卫,激活时编辑器上边框显示 <code>plan</code> 徽标。</p>
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

<h2><span data-l="en">What's next</span><span data-l="zh">下一步</span></h2>
<div class="roadmap-grid">
<div class="card reveal" markdown="1">
### <span data-l="en">Own companion tools</span><span data-l="zh">自有伴随工具</span>
<span data-l="en">Reimplement the todo overlay and the interactive question tool as harness-native versions — deeper integration with goal, permission, and the swarm widget instead of external packages.</span><span data-l="zh">把 todo 浮层和交互式问卷复现为 harness 原生版本——与 goal、permission、swarm widget 深度集成,不再依赖外部包。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">i18n, properly</span><span data-l="zh">完善 i18n</span>
<span data-l="en">Bilingual harness UI text and notifications, docs already split en/zh-CN — and this page is bilingual too (toggle in the nav).</span><span data-l="zh">harness 界面文案与通知双语化,文档已拆分中英——本页面也已支持双语(导航栏切换)。</span>
</div>
<div class="card reveal" markdown="1">
### <span data-l="en">Math &amp; fullscreen</span><span data-l="zh">公式与全屏</span>
<span data-l="en">Graduate the txm math renderer from <code>feature/math-renderer</code> once compaction-path context safety is confirmed; true editor pinning when pi-core lands alternate-screen.</span><span data-l="zh">待压缩路径的上下文安全性确认后,把 txm 公式渲染从 <code>feature/math-renderer</code> 合入主线;pi-core 支持 alternate screen 后实现真钉底。</span>
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
