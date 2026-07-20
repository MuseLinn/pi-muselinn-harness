// ============================================================
// Swarm Mode — Report Formatter
// ============================================================

import type { SwarmState } from "./types.ts";
import { fmtDuration, fmtTokens, fmtCost } from "./helpers.ts";

export function formatReport(state: SwarmState): string {
  const lines = [
    `# Swarm Report: ${state.name}`,
    "",
    `**Mode:** ${state.mode} | **Tier:** ${state.modelTier} | **Status:** ${state.status}`,
    "",
    "## Tasks",
    "",
  ];

  for (const task of state.tasks) {
    const icon =
      task.status === "done"
        ? "✓"
        : task.status === "failed"
          ? "✗"
          : task.status === "aborted"
            ? "⚠"
            : "○";
    const dur =
      task.startTime && task.endTime
        ? fmtDuration(task.endTime - task.startTime)
        : "N/A";
    lines.push(
      `### ${icon} ${task.agent}: ${(task.item || task.task || "").slice(0, 50)}`,
    );
    lines.push(
      `- **Model:** ${task.model} | **Duration:** ${dur} | **Turns:** ${task.turns}`,
    );
    lines.push(
      `- **Tokens:** ↑${fmtTokens(task.usage.input)} ↓${fmtTokens(task.usage.output)} | **Cost:** ${fmtCost(task.usage.cost)}`,
    );
    if (task.error) lines.push(`- **Error:** ${task.error}`);
    lines.push("");
  }

  const totalCost = state.tasks.reduce((s, t) => s + t.usage.cost, 0);
  lines.push("## Total");
  lines.push(`- **Cost:** ${fmtCost(totalCost)}`);
  if (state.endTime)
    lines.push(
      `- **Duration:** ${fmtDuration(state.endTime - state.startTime)}`,
    );

  return lines.join("\n");
}
