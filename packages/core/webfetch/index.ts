// ============================================================
// Web fetch — content extraction helpers (pure, no host imports).
//
// Small dependency-free HTML→text extractor for the fetch_url tool:
// drop script/style/noscript blocks, strip tags, decode the common
// entities, collapse whitespace. JSON is pretty-printed, everything
// else passes through raw. Not a readability clone — good enough for
// model consumption of docs/APIs, and safe on broken markup.
// ============================================================

/** Default result cap (chars) returned to the model. */
export const WEBFETCH_MAX_CHARS = 20_000;

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Extract readable text from HTML; JSON pretty-prints; else raw. */
export function extractWebText(body: string, contentType: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("application/json") || ct.includes("+json")) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      return body; // broken JSON — pass through
    }
  }
  if (!ct.includes("text/html") && !ct.includes("application/xhtml")) {
    return body; // plain text, xml, csv, … — pass through
  }
  return htmlToText(body);
}

/** Strip HTML down to readable text. Never throws on bad markup. */
export function htmlToText(html: string): string {
  let s = html;
  try {
    // Drop non-content blocks entirely (script/style/noscript/template/svg).
    s = s.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ");
    // Line-break boundaries for block-ish tags before stripping.
    s = s.replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|ul|ol|table|blockquote|pre)>/gi, "\n");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    // Strip all remaining tags.
    s = s.replace(/<[^>]*>/g, "");
    // Decode common entities (named first, then numeric).
    s = s.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITY_MAP[m] ?? m);
    s = s.replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : _;
    });
    // Collapse whitespace: trim lines, drop 3+ blank runs.
    s = s
      .split("\n")
      .map((l) => l.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return s;
  } catch {
    return html.replace(/<[^>]*>/g, " ");
  }
}

/** Cap extracted text with a truncation marker (mirrors fetch_url output). */
export function truncateWebText(text: string, maxChars: number = WEBFETCH_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + `\n\n[... truncated: ${text.length} chars total, increase max_chars or fetch a more specific page ...]`;
}
