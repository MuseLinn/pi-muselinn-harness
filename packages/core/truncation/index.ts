// ============================================================
// Tool result truncation — spill oversized tool output to disk and
// keep only a preview + recoverable pointer in the context (pure).
//
// Kimi Code's toolResultTruncation pattern (agent/toolResultTruncation):
// a runaway `npm test` or build log must not eat the context window;
// the full text lands in a file the model can page through with read.
// ============================================================

import { sanitizeShellOutput } from "../shell-output.ts";

/** Spill threshold: results larger than this are written to disk. */
export const TRUNCATION_THRESHOLD_CHARS = 40_000;
/** Preview budget: first HEAD + last TAIL chars stay in the context. */
export const TRUNCATION_HEAD_CHARS = 1_500;
export const TRUNCATION_TAIL_CHARS = 500;

/** True when a text result exceeds the spill threshold. */
export function shouldTruncate(text: string): boolean {
  return typeof text === "string" && text.length > TRUNCATION_THRESHOLD_CHARS;
}

/** File path for a spilled result. */
export function truncationPathFor(dir: string, toolName: string, toolCallId: string): string {
  const safeId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${dir}/tool-results/${toolName}-${safeId}.txt`;
}

/**
 * Build the context-facing replacement: sanitized head + spill marker +
 * sanitized tail. The marker carries the output_path and the paging
 * instruction so the model can recover the full content with read.
 */
export function buildTruncatedPreview(text: string, outputPath: string): string {
  const head = sanitizeShellOutput(text.slice(0, TRUNCATION_HEAD_CHARS));
  const tail = sanitizeShellOutput(text.slice(-TRUNCATION_TAIL_CHARS));
  const totalLines = text.split("\n").length;
  return (
    `${head}\n\n` +
    `[... output truncated: ${text.length} chars / ${totalLines} lines total — ` +
    `full output saved to ${outputPath} ; page through it with read (offset/limit) ...]\n\n` +
    `${tail}`
  );
}
