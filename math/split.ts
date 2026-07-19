// ============================================================
// Math — LaTeX block splitting (pure, no pi imports).
//
// v1 scope: display math $$...$$ only. Inline $...$ is skipped — a
// cell-rendered formula is multi-line and can't splice mid-line without
// breaking the text flow. Fenced code blocks are passed through as
// markdown so formulas inside them are never rendered.
// ============================================================

export interface MathSegment {
  type: "markdown" | "math";
  text: string;
}

const BLOCK_RE =
  /(```[\s\S]*?```|~~~[\s\S]*?~~~|\$\$[\s\S]+?\$\$)/g;

/** Quick gate: does the text contain a display-math block? */
export function hasDisplayMath(md: string): boolean {
  return /\$\$[\s\S]+?\$\$/.test(md);
}

/** Extract the TeX source from a $$...$$ block (delimiters stripped). */
export function extractTex(block: string): string {
  return block.replace(/^\$\$/, "").replace(/\$\$$/, "").trim();
}

/** Split markdown into markdown/math segments, code fences left intact. */
export function splitMathBlocks(md: string): MathSegment[] {
  const segments: MathSegment[] = [];
  let cursor = 0;
  BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_RE.exec(md))) {
    if (match.index > cursor) {
      segments.push({ type: "markdown", text: md.slice(cursor, match.index) });
    }
    const token = match[0];
    if (token.startsWith("$$")) {
      segments.push({ type: "math", text: token });
    } else {
      // fenced code block — never rendered
      segments.push({ type: "markdown", text: token });
    }
    cursor = match.index + token.length;
  }
  if (cursor < md.length) {
    segments.push({ type: "markdown", text: md.slice(cursor) });
  }
  return segments;
}

/**
 * Reassemble segments into markdown, replacing each math block with its
 * rendered form when the renderer succeeded (non-null), keeping the
 * original LaTeX otherwise (fail-open).
 */
export async function renderMathInMarkdown(
  md: string,
  render: (tex: string) => Promise<string | null>,
): Promise<string> {
  const segments = splitMathBlocks(md);
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.type === "math") {
      const rendered = await render(extractTex(segment.text));
      parts.push(rendered !== null ? `\n${rendered}\n` : segment.text);
    } else {
      parts.push(segment.text);
    }
  }
  return parts.join("");
}
