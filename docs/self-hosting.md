---
layout: default
title: Self-hosted development
---

<h1><span data-l="en">Self-hosted development</span><span data-l="zh">自举开发指南</span></h1>
<p><span data-l="en">How to build the tool you run every day without blowing up your daily driver — the dual-track workflow, plus how Linux, Karpathy, and the OpenClaw author handle eating their own dogfood.</span><span data-l="zh">如何开发「自己每天都在用」的工具而不把日常环境玩坏——双轨工作流,以及 Linux、Karpathy、OpenClaw 作者各自的自举实践。</span></p>

<h2><span data-l="en">The trap: repo as production directory</span><span data-l="zh">陷阱:仓库即生产目录</span></h2>
<p><span data-l="en">This harness itself was born inside <code>~/.pi/agent/extensions/</code> — the git repo <em>was</em> the live extension. Three risks showed up immediately:</span><span data-l="zh">本 harness 最初就诞生在 <code>~/.pi/agent/extensions/</code> 里——git 仓库<em>就是</em>正在运行的扩展。三个风险立刻显现:</span></p>

- <span data-l="en"><strong>Bootstrap fragility</strong>: you use the harness to develop the harness. One broken intermediate state, and tomorrow's agent starts crippled — the very tool you'd use to fix it.</span><span data-l="zh"><strong>自举脆弱性</strong>:你用这个 harness 开发这个 harness。一次中间态的坏改动,明天启动的 agent 直接残了——而你本来要靠它修自己。</span>
- <span data-l="en"><strong>No stable anchor</strong>: npm says 0.7.1, but you're running whatever the working tree happens to be. User bug reports become irreproducible.</span><span data-l="zh"><strong>无稳定锚点</strong>:npm 上是 0.7.1,本机跑的却是工作区任意时刻的状态。用户报 bug 你无法复现。</span>
- <span data-l="en"><strong>Checkout = production switch</strong>: switching to a feature branch silently changes your production environment.</span><span data-l="zh"><strong>切分支即切生产</strong>:checkout 一个 feature 分支,你的生产环境就跟着变了。</span>

<h2><span data-l="en">The dual-track workflow</span><span data-l="zh">双轨工作流</span></h2>
<p><span data-l="en"><strong>Daily use = your published stable.</strong> Remove the in-place pointer and eat the same bowl as your users:</span><span data-l="zh"><strong>日常使用 = 你发布的稳定版。</strong>卸掉原位指针,和用户吃同一碗饭:</span></p>

```bash
pi remove  local:~/.pi/agent/extensions/pi-muselinn-harness   # avoid double-loading
pi install npm:pi-muselinn-harness                            # same bits as everyone else
```

<p><span data-l="en"><strong>Development = project-scoped loading.</strong> Move the repo to your normal project area, and load the dev version only where you test it — a scratch project with <code>.pi/extensions/</code> symlinked back. The global npm install stays untouched; a broken experiment only breaks the scratch project.</span><span data-l="zh"><strong>开发 = 项目级加载。</strong>仓库挪到正常项目区,开发版只在试验项目里加载——scratch 项目里放 <code>.pi/extensions/</code> 软链回仓库。全局 npm 稳定版不受影响,玩砸了也只是那个项目的事。</span></p>

<p><span data-l="en"><strong>Release = a conscious cut.</strong> feature branch → full test suite green → merge to main → bump → publish → tag → <code>pi update</code> on your machine. Publishing stops being "push whatever" and becomes a deliberate act with a version anchor.</span><span data-l="zh"><strong>发布 = 有意识的 cut。</strong>feature 分支 → 测试全绿 → 合 main → bump → publish → tag → 本机 <code>pi update</code>。发布从「顺手一推」变成带版本锚点的刻意动作。</span></p>

<h2><span data-l="en">How the masters do it</span><span data-l="zh">名家怎么做</span></h2>

<h3><span data-l="en">Linux &amp; GCC: bootstrap with a trusted stage0</span><span data-l="zh">Linux 与 GCC:可信 stage0 的自举</span></h3>
<p><span data-l="en">GCC compiles itself in three stages: the system compiler builds stage1, stage1 builds stage2, stage2 builds stage3 — then stage2 and stage3 are compared bit-for-bit. Self-hosting is only trusted when the final artifact can <em>reproduce itself</em>. Git followed the same arc: Linus wrote it in about two weeks in April 2005 and immediately moved git's own history onto it — but the initial import came from a trusted external state. Lesson: keep a known-good fallback you can always rebuild from, and make "rebuild from scratch" a routine, verified path.</span><span data-l="zh">GCC 用三阶段编译自己:系统编译器产出 stage1,stage1 产出 stage2,stage2 产出 stage3——然后逐字节对比 stage2 与 stage3。自举只有在产物能<em>复现自身</em>时才被信任。git 也走过同样的路:2005 年 4 月 Linus 用约两周写出 git,随即将 git 自己的历史导入自托管——但初始导入来自可信的外部状态。教训:永远保留一个已知良好的可回退版本,并把「从零重建」变成例行的、被验证的路径。</span></p>

<h3><span data-l="en">Karpathy: small surface, evals before agents</span><span data-l="zh">Karpathy:小表面积,评估先行</span></h3>
<p><span data-l="en">Andrej Karpathy's self-hosting tools (micrograd, nanoGPT, llm.c) are deliberately tiny — small enough that one person can read every line, which is exactly what makes them safe to modify with AI assistance. His public guidance on agentic coding is consistent: <em>write the evals first</em>, then let the agent iterate against them. The harness equivalent: our 269 pure-node assertions run without model quota, so every change is gated by a cheap, deterministic check before it ever reaches a session.</span><span data-l="zh">Karpathy 的自举工具(micrograd、nanoGPT、llm.c)都刻意做小——小到一个人能读完每一行,而这正是敢让 AI 参与修改的前提。他关于 agentic coding 的公开建议始终如一:<em>先写评估,再让 agent 迭代</em>。对应到本 harness:269 项纯 node 断言不烧模型额度,任何改动先过一道便宜、确定性的门禁,才轮到真实会话。</span></p>

<h3><span data-l="en">steipete (OpenClaw): the agent fixes itself, the human reviews</span><span data-l="zh">steipete(OpenClaw,社区称「龙虾之父」):agent 修自己,人来把关</span></h3>
<p><span data-l="en">Peter Steinberger built OpenClaw largely with the agent itself — it patches its own code, opens its own PRs, restarts into its own new builds. The reason this doesn't collapse is the scaffolding around it: heavy CI on every change, fast rollback habits, and a human who owns architecture decisions and reviews what lands. Dogfooding at that intensity works because the <em>safety rails are built first</em>, not after the first fire.</span><span data-l="zh">Peter Steinberger 用 OpenClaw 自身完成了它大部分的开发——自己改代码、自己提 PR、重启进自己的新构建。这套玩法不塌的原因是周围的脚手架:每次改动都有重 CI、快速回滚的习惯、以及一个始终掌握架构决策和 review 的人类。这种强度的自举能成立,是因为<em>安全栏杆先于事故建好</em>,而不是等第一次着火。</span></p>

<h2><span data-l="en">The checklist</span><span data-l="zh">落地清单</span></h2>

- <span data-l="en">Move source repos out of runtime data directories (<code>~/.pi/agent/extensions/</code> is pi's data dir, not your workspace)</span><span data-l="zh">源码仓库挪出运行时数据目录(<code>~/.pi/agent/extensions/</code> 是 pi 的数据目录,不是你的工作区)</span>
- <span data-l="en">main = production discipline: all work on feature branches, merge only when the full suite is green</span><span data-l="zh">main = 生产纪律:一切改动走 feature 分支,测试全绿才合并</span>
- <span data-l="en">Daily driver runs the published version; dev version loads only in scratch projects</span><span data-l="zh">日常环境跑发布版;开发版只在 scratch 项目里加载</span>
- <span data-l="en">Every release is a conscious cut: bump → publish → tag → upgrade locally</span><span data-l="zh">每次发布都是刻意的 cut:bump → publish → tag → 本机升级</span>
- <span data-l="en">A trusted stage0: you can always uninstall the extension and pi still works — your tools never take the host down with them</span><span data-l="zh">可信 stage0:随时能卸载扩展而 pi 照常工作——工具永远不能拖垮宿主</span>
- <span data-l="en">Evals before agents: a cheap deterministic test suite gates every change</span><span data-l="zh">评估先行:便宜、确定性的测试套件为每次改动把关</span>

<h2><span data-l="en">Links</span><span data-l="zh">链接</span></h2>

- <span data-l="en">Back to <a href="./">pi-muselinn-harness</a></span><span data-l="zh">返回 <a href="./">pi-muselinn-harness</a></span>
