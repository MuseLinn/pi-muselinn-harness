// webfetch extraction unit tests (pure, no network).
const { extractWebText, htmlToText, truncateWebText, WEBFETCH_MAX_CHARS } = await import("../packages/core/webfetch/index.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// 1. HTML extraction
const html = `<html><head><style>.a{color:red}</style><script>var x=1;</script></head>
<body><h1>Title</h1><p>Hello <b>world</b> &amp; friends</p><ul><li>one</li><li>two</li></ul>
<script>alert(1)</script><p>tail&nbsp;here</p></body></html>`;
const text = htmlToText(html);
check("drops script/style", !text.includes("var x") && !text.includes("color:red") && !text.includes("alert"));
check("keeps content", text.includes("Title") && text.includes("Hello world"));
check("decodes entities", text.includes("& friends") && text.includes("tail here"));
check("list items on separate lines", /one\ntwo/.test(text.replace(/\n\n/g, "\n")));

// 2. Broken markup never throws
check("broken markup safe", typeof htmlToText("<div><p>oops") === "string");
check("empty input", htmlToText("") === "");

// 3. JSON pretty-print
const json = extractWebText('{"a":1,"b":[2,3]}', "application/json; charset=utf-8");
check("json pretty", json.includes('"a": 1') && json.includes("\n"));
check("broken json passthrough", extractWebText("{bad", "application/json") === "{bad");

// 4. Non-html non-json passthrough
check("plain text passthrough", extractWebText("raw text", "text/plain") === "raw text");
check("csv passthrough", extractWebText("a,b,c", "text/csv") === "a,b,c");

// 5. Truncation
const big = "y".repeat(WEBFETCH_MAX_CHARS + 100);
const t = truncateWebText(big);
check("truncates with marker", t.length < big.length && t.includes("truncated"));
check("small text untouched", truncateWebText("short") === "short");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
