# Recording the swarm demo / Swarm 演示录制指南

The GIF is **not recorded yet**. Target: `docs/demo/swarm.gif`. Both READMEs deliberately use text placeholders until a real recording is checked in.

## Setup / 准备

- Use a disposable, small public project with recognizable entry points and tests; never a private checkout. Have pi installed and a working model configured before recording.
- Install with `pi install npm:pi-muselinn-harness`, then launch `pi` in that project. Do not include installation downloads or model authentication in the clip.
- Use a 100–120 column × 30–36 row terminal, 18–20 px monospace font, and a high-contrast dark theme (e.g. pi's dark theme). Keep the palette and window size fixed; ensure the progress panel and prompt fit without wrapping excessively.
- 建议先试跑一遍，确认两个任务确实并发、面板可见、输出足够简短。不要靠剪辑拼出未发生过的并发。

## Shot script / 分镜（目标 20–30 秒）

1. **0–4 s:** Enter `/tui style compact`, then `/tui style boxed` to show the immediate editor change.
2. **4–6 s:** Enter `/swarm on`; hold briefly on the `swarm` status label.
3. **6–10 s:** Paste the following as a normal prompt, not a slash command:

   ```text
   Use agent_swarm with two explore subagents and max_concurrency=2: one summarizes this project’s entry points, the other summarizes its tests. Do not edit files. Return a short combined summary.
   ```

4. **10–23 s:** Show the actual `agent_swarm` call and both tasks progressing in the live panel. Handle any permission dialog normally; do not change permission modes just to hide approvals.
5. **23–30 s:** Hold on completed tasks and the combined summary. Optionally open `/tasks` after completion to show task details; `Esc` closes it. Omit this if it makes the clip too long.

Model latency varies: these timings are an editing target, not a runtime promise. Trim or accelerate idle waits with a visible “wait shortened” annotation; preserve real tool calls, task states, and results. If parallel dispatch does not happen, retry the prompt rather than fabricating a frame.

中文录制可使用 README.zh-CN.md 中对应的提示语；分镜、命令和预期画面相同。

## Privacy and export / 隐私与导出

- Use a neutral shell prompt and demo directory such as `/tmp/harness-demo`. Hide usernames, hostnames, home paths, session paths, account names, browser tabs, notifications, and shell history.
- Keep API keys, environment variables, authentication screens, private URLs, and private source out of view. Configure credentials before recording; never print `.env` or credential files. Inspect tool outputs and summary text too.
- Review the entire capture frame by frame before exporting. If secrets appear, re-record; do not rely on a blur to remove a leaked credential.
- Export a legible looping GIF at roughly 10–15 fps; aim for under 5 MB without making text unreadable. Save it as `docs/demo/swarm.gif`.
- Only after the file exists and is reviewed, replace the explicit placeholders in **both** READMEs with Markdown image links to `docs/demo/swarm.gif` and retain their captions. Keep this guide linked for future recordings.

## Verified controls / 命令来源

- `tui/index.ts` and `packages/core/tui/parse.ts`: `/tui style compact` and `/tui style boxed`.
- `swarm/commands.ts`: `/swarm on`, `/tasks`, and `/swarm-resume` (swarm recovery; `/resume` is not its command).
- `index.ts`: `agent_swarm` accepts `subagent_type: explore`, `items`, `prompt_template`, and `max_concurrency`; the normal-language prompt asks the model to invoke this tool. Enabling swarm alone does not launch agents.
