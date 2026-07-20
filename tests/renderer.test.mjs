// renderer unit tests (pure, no terminal needed).
const { diffFrames, opsToAnsi } = await import("../packages/renderer/buffer.ts");
const { ComponentStack } = await import("../packages/renderer/tree.ts");
const { Renderer, StringWriter } = await import("../packages/renderer/renderer.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

// ── diffFrames ──
check("identical → no ops", diffFrames(["a", "b"], ["a", "b"]).length === 0);
{
  const ops = diffFrames(["a", "b"], ["a", "X"]);
  check("change tail: moveTo + write", ops.length === 2 && ops[0].type === "moveTo" && ops[0].row === 1 && ops[1].text === "X");
}
{
  const ops = diffFrames(["a"], ["a", "b", "c"]);
  check("grow: moveTo 1 + 2 writes", ops.length === 3 && ops[0].row === 1 && ops[1].text === "b" && ops[2].text === "c");
}
{
  const ops = diffFrames(["a", "b", "c"], ["a"]);
  check("shrink: moveTo 1 + clearToEnd", ops.length === 2 && ops[0].row === 1 && ops[1].type === "clearToEnd");
}
{
  const ops = diffFrames(["a", "b", "c"], ["a", "X"]);
  check("change+shrink", ops.length === 3 && ops[1].text === "X" && ops[2].type === "clearToEnd");
}

// ── opsToAnsi ──
{
  const { ansi } = opsToAnsi([{ type: "moveTo", row: 1 }, { type: "write", text: "X" }], 3);
  check("moves up 2 + home + write + EOL clear", ansi === "\x1b[2A\rX\x1b[K", JSON.stringify(ansi));
}
{
  const { ansi } = opsToAnsi([{ type: "moveTo", row: 1 }, { type: "write", text: "a" }, { type: "write", text: "b" }], 1);
  check("consecutive writes separated by CRLF", ansi === "\ra\x1b[K\r\nb\x1b[K", JSON.stringify(ansi));
}

// ── ComponentStack damage tracking ──
{
  let rendersA = 0, rendersB = 0;
  const a = { render: () => { rendersA++; return ["A"]; }, fingerprint: () => "fa" };
  const b = { render: () => { rendersB++; return ["B1", "B2"]; }, fingerprint: () => "fb" };
  const stack = new ComponentStack();
  stack.add(a); stack.add(b);
  const first = stack.render(80);
  check("first render concatenates", first.join("|") === "A|B1|B2");
  stack.render(80);
  check("second render uses cache (no re-render)", rendersA === 1 && rendersB === 1, `a=${rendersA} b=${rendersB}`);
  b.fingerprint = () => "fb2";
  stack.render(80);
  check("fingerprint change re-renders only that child", rendersA === 1 && rendersB === 2, `a=${rendersA} b=${rendersB}`);
  stack.render(40);
  check("width change re-renders both", rendersA === 2 && rendersB === 3);
  stack.invalidate();
  stack.render(40);
  check("invalidate re-renders both", rendersA === 3 && rendersB === 4);
}

// ── Renderer frame loop ──
{
  const stack = new ComponentStack();
  let lines = ["l1", "l2"];
  stack.add({ render: () => lines, fingerprint: () => lines.join("") });
  const writer = new StringWriter();
  const r = new Renderer(stack, writer, { intervalMs: 1, width: () => 80 });
  r.requestFullRender();
  check("first frame clears + paints", writer.text.includes("\x1b[2J\x1b[H") && writer.text.includes("l1\x1b[K\r\nl2\x1b[K"), JSON.stringify(writer.text));
  const before = writer.text.length;
  r.requestRender();
  await new Promise((res) => setTimeout(res, 10));
  check("settled frame writes nothing", writer.text.length === before, `grew ${writer.text.length - before}`);
  lines = ["l1", "l2-changed"];
  r.requestRender();
  await new Promise((res) => setTimeout(res, 10));
  check("changed frame writes only the diff", writer.text.includes("l2-changed") && !writer.text.includes("\x1b[2J", 1), "");
  r.stop();
}

// coalescing: multiple requests in one tick → single frame
{
  const stack = new ComponentStack();
  let renders = 0;
  stack.add({ render: () => { renders++; return ["x"]; }, fingerprint: () => String(renders > 0) });
  const writer = new StringWriter();
  const r = new Renderer(stack, writer, { intervalMs: 5, width: () => 80 });
  r.requestRender(); r.requestRender(); r.requestRender();
  await new Promise((res) => setTimeout(res, 20));
  check("burst collapses to one frame", renders <= 2, `renders=${renders}`); // first + at most one more
  r.stop();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
