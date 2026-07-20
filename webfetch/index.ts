// ============================================================
// Web fetch — fetch_url tool (adapter). Kimi parity: always
// available, no OAuth. Size-capped, timeout-guarded, content-aware
// extraction (HTML → text, JSON → pretty, else raw).
// ============================================================

import { extractWebText, truncateWebText, WEBFETCH_MAX_CHARS } from "../packages/core/webfetch/index";

const FETCH_TIMEOUT_MS = 20_000;
const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const USER_AGENT = "pi-muselinn-harness fetch_url (+https://github.com/MuseLinn/pi-muselinn-harness)";

async function fetchWithLimit(url: string): Promise<{ body: string; contentType: string; status: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/json,text/plain,*/*;q=0.8" },
    });
    const contentType = res.headers.get("content-type") ?? "";
    const reader = res.body?.getReader();
    if (!reader) return { body: "", contentType, status: res.status };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > FETCH_MAX_BYTES) {
          try { await reader.cancel(); } catch { /* ok */ }
          break;
        }
        chunks.push(value);
      }
    }
    const body = new TextDecoder("utf-8", { fatal: false }).decode(
      chunks.length === 1 ? chunks[0] : Uint8Array.from(chunks.flatMap((c) => [...c])),
    );
    return { body, contentType, status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

export function registerFetchUrl(pi: any): void {
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    promptSnippet: "fetch_url: fetch a URL and extract readable text (HTML→text, JSON→pretty)",
    promptGuidelines: [
      "Use fetch_url to read documentation, API responses, or public pages the task depends on",
      "Prefer specific URLs (docs sections, raw files) over landing pages — extraction is heuristic",
      "Increase max_chars only when the first fetch shows the answer is below the cut",
    ],
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The http(s) URL to fetch" },
        max_chars: { type: "number", description: `Max characters to return (default ${WEBFETCH_MAX_CHARS})` },
      },
      required: ["url"],
    },
    async execute(_toolCallId: string, params: any, _signal: any, _onUpdate: any, _ctx: any) {
      const url = String(params?.url ?? "");
      if (!/^https?:\/\//i.test(url)) {
        return { content: [{ type: "text", text: `fetch_url: url must start with http:// or https:// (got: ${url || "<empty>"})` }] };
      }
      const maxChars = Number.isFinite(params?.max_chars) && params.max_chars > 0
        ? Math.min(params.max_chars, 200_000)
        : WEBFETCH_MAX_CHARS;
      try {
        const { body, contentType, status } = await fetchWithLimit(url);
        if (status >= 400) {
          return { content: [{ type: "text", text: `fetch_url: HTTP ${status} for ${url}\n${truncateWebText(body.slice(0, 1000), 1000)}` }] };
        }
        const text = truncateWebText(extractWebText(body, contentType), maxChars);
        return { content: [{ type: "text", text: text || `(empty response from ${url})` }] };
      } catch (err: any) {
        const msg = err?.name === "AbortError" ? `timed out after ${FETCH_TIMEOUT_MS / 1000}s` : (err?.message ?? String(err));
        return { content: [{ type: "text", text: `fetch_url: failed for ${url}: ${msg}` }] };
      }
    },
  });
}
