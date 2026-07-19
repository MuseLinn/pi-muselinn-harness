// ============================================================
// Math — event wiring: render $$...$$ blocks in assistant messages
// for display, restore the original Markdown before every LLM call.
//
// Context-safety pattern verified from dbydd/pi-rich-renderer: the
// original content is stashed on the message under ORIGINAL_FIELD and
// pi.on("context") swaps it back, so the model never sees rendered
// output. v1 renders display math only (see split.ts).
// ============================================================

import { hasDisplayMath, renderMathInMarkdown } from "./split";
import { renderFormula, detectTxm } from "./txm";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ORIGINAL_FIELD = "__muselinnMathOriginal";

let enabled = true;
let notifiedMissing = false;

/** Toggle at runtime (/tui math on|off). */
export function setMathEnabled(value: boolean): void {
  enabled = value;
}

export function isMathEnabled(): boolean {
  return enabled;
}

export function registerMath(pi: ExtensionAPI): void {
  // Restore original Markdown before the messages are sent to the model.
  pi.on("context", (event: any) => {
    if (!Array.isArray(event?.messages)) return undefined;
    let touched = false;
    const messages = event.messages.map((m: any) => {
      if (m?.role === "assistant" && Array.isArray(m?.[ORIGINAL_FIELD])) {
        touched = true;
        return { ...m, content: m[ORIGINAL_FIELD] };
      }
      return m;
    });
    return touched ? { messages } : undefined;
  });

  // After an assistant message completes, swap $$...$$ blocks for their
  // cell-rendered form (display only; context restore above keeps the
  // model-facing content untouched).
  pi.on("message_end" as any, async (event: any, ctx: any) => {
    if (!enabled) return;
    const message = event?.message;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) return;
    if (message[ORIGINAL_FIELD]) return;
    if (message.stopReason && !["stop", "length"].includes(message.stopReason)) return;

    const parts = message.content as Array<any>;
    if (!parts.some((p) => p?.type === "text" && typeof p.text === "string" && hasDisplayMath(p.text))) return;

    if (!(await detectTxm())) {
      if (!notifiedMissing) {
        notifiedMissing = true;
        try {
          ctx?.ui?.notify?.("math: txm not found — formulas stay raw. Install with: cargo install txm (or /tui math off)", "info");
        } catch { /* stale ctx */ }
      }
      return;
    }

    let changed = false;
    const newContent: Array<any> = [];
    for (const part of parts) {
      if (part?.type === "text" && typeof part.text === "string" && hasDisplayMath(part.text)) {
        const rendered = await renderMathInMarkdown(part.text, renderFormula);
        if (rendered !== part.text) {
          changed = true;
          newContent.push({ ...part, text: rendered });
          continue;
        }
      }
      newContent.push(part);
    }
    if (!changed) return;

    return {
      message: {
        ...message,
        [ORIGINAL_FIELD]: message.content,
        content: newContent,
      },
    };
  });
}
