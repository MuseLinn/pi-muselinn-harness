// tool result truncation unit tests (pure, no pi runtime needed).
const {
  shouldTruncate,
  truncationPathFor,
  buildTruncatedPreview,
  TRUNCATION_THRESHOLD_CHARS,
  TRUNCATION_HEAD_CHARS,
  TRUNCATION_TAIL_CHARS,
} = await import("../packages/core/truncation/index.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// 1. shouldTruncate
check("small text not truncated", !shouldTruncate("hello"));
check("exactly at threshold not truncated", !shouldTruncate("x".repeat(TRUNCATION_THRESHOLD_CHARS)));
check("over threshold truncated", shouldTruncate("x".repeat(TRUNCATION_THRESHOLD_CHARS + 1)));
check("non-string safe", !shouldTruncate(null) && !shouldTruncate(undefined) && !shouldTruncate(42));

// 2. truncationPathFor
check("path shape", truncationPathFor("/tmp/sess", "bash", "tc-1") === "/tmp/sess/tool-results/bash-tc-1.txt");
check("unsafe id sanitized", truncationPathFor("/d", "read", "a/b\\c:d").includes("a_b_c_d"));

// 3. buildTruncatedPreview
const big = "H".repeat(TRUNCATION_HEAD_CHARS) + "\n" + "M".repeat(50000) + "\n" + "T".repeat(TRUNCATION_TAIL_CHARS);
const preview = buildTruncatedPreview(big, "/tmp/out.txt");
check("head preserved", preview.startsWith("H".repeat(50)));
check("tail preserved", preview.endsWith("T".repeat(TRUNCATION_TAIL_CHARS)));
check("output_path in marker", preview.includes("/tmp/out.txt"));
check("char count in marker", preview.includes(String(big.length)));
check("paging instruction", preview.includes("read") && preview.includes("offset"));
check("middle omitted", !preview.includes("M".repeat(2000)));

// 4. preview sanitizes control sequences
const messy = "\x1b[31m" + "x".repeat(TRUNCATION_THRESHOLD_CHARS + 100);
const p2 = buildTruncatedPreview(messy, "/tmp/o.txt");
check("preview sanitized", !p2.includes("\x1b[31m"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
