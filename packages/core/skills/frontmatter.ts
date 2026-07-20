// ============================================================
// Skills — Minimal YAML frontmatter parser (no npm deps)
// ============================================================
// Supports only the subset Kimi Code Agent Skills need:
//   ---
//   key: scalar            (string / boolean / number-as-string)
//   key: "quoted string"
//   key: [a, b, c]         (inline string array)
//   key:                   (block string array)
//     - item1
//     - item2
//   ---
// Anything more exotic (nested maps, multi-line scalars) is treated
// as a plain string — skills frontmatter never needs it.

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  body: string;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2) {
    const first = v[0];
    const last = v[v.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return v.slice(1, -1);
    }
  }
  return v;
}

function parseScalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return "";
  const lower = v.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  // Inline array: [a, b, c]
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner === "") return [] as string[];
    return inner.split(",").map((item) => unquote(item)).filter((s) => s !== "");
  }
  return unquote(v);
}

/**
 * Extract a YAML frontmatter block delimited by `---` lines at the very
 * start of the file (a leading BOM or blank lines are tolerated).
 * Returns { data, body }; when no block exists data is {} and body is
 * the original content.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const text = content.replace(/^\uFEFF/, ""); // strip BOM
  const lines = text.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  if (start >= lines.length || lines[start].trim() !== "---") {
    return { data: {}, body: content };
  }
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === "---" || lines[i].trim() === "...") {
      end = i;
      break;
    }
  }
  if (end < 0) {
    return { data: {}, body: content };
  }

  const data: Record<string, unknown> = {};
  let pendingArrayKey: string | null = null;
  for (let i = start + 1; i < end; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // Block array item: "- value" (only meaningful right after `key:`)
    const itemMatch = trimmed.match(/^-\s+(.*)$/);
    if (itemMatch && pendingArrayKey) {
      (data[pendingArrayKey] as string[]).push(unquote(itemMatch[1]));
      continue;
    }

    const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kvMatch) {
      pendingArrayKey = null;
      continue;
    }
    const key = kvMatch[1];
    const rawValue = kvMatch[2];
    if (rawValue === "") {
      // Could be a block array ("key:" then "- item" lines) or an empty
      // scalar. Start an array; if no items follow it stays [].
      data[key] = [] as string[];
      pendingArrayKey = key;
    } else {
      data[key] = parseScalar(rawValue);
      pendingArrayKey = null;
    }
  }
  // Collapse "key:" with no items back to an empty string (it was an
  // empty scalar, not an array).
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0) data[k] = "";
  }

  return { data, body: lines.slice(end + 1).join("\n") };
}

/** First non-empty line of the body, truncated to 240 chars (Kimi Code rule). */
export function fallbackDescription(body: string): string {
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line !== "") {
      return line.length > 240 ? line.slice(0, 240) : line;
    }
  }
  return "";
}

/** Read a frontmatter field accepting camelCase / kebab-case / snake_case variants. */
export function getField(data: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in data) return data[key];
  }
  return undefined;
}

/** Normalize an `arguments` field: string[] or whitespace-separated string → string[]. */
export function normalizeArguments(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    return value.map((v) => String(v)).filter((s) => s.trim() !== "");
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter((s) => s !== "");
  }
  return undefined;
}
