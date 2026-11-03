// Behavioral regression for #5. Use the real registration, execute handler,
// and dialog/key handling; only the host UI and batch scheduler are modeled.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jitiUrl } from "./jiti-path.mjs";

const { createJiti } = await import(jitiUrl());
const jiti = createJiti(import.meta.url, { moduleCache: false });
const nativeRequire = createRequire(import.meta.url);
const tui = await import("@earendil-works/pi-tui");
const cache = new Map();
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} };
  cache.set(file, module);
  const code = jiti.transform({ source: readFileSync(file, "utf8"), filename: file, ts: true });
  const localRequire = (spec) => {
    if (spec === "@earendil-works/pi-tui") return tui;
    if (spec === "../task/index") return { backgroundManager: new Proxy({}, {
      get() { throw new Error("Background tasks are outside this foreground test"); },
    }) };
    if (!spec.startsWith(".")) return nativeRequire(spec);
    const base = path.resolve(path.dirname(file), spec.replace(/\.js$/, ""));
    const resolved = [base + ".ts", base + ".js", base, base + "/index.ts"]
      .find((p) => existsSync(p) && statSync(p).isFile());
    if (!resolved) throw new Error(`Cannot resolve ${spec} from ${file}`);
    return loadTs(resolved);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", code)(
    module.exports, localRequire, module, file, path.dirname(file));
  return module.exports;
}
const { registerAskUserQuestion } = loadTs(fileURLToPath(new URL("../ask/index.ts", import.meta.url)));

// pi-agent-core executeToolCalls semantics: any sequential tool makes the
// WHOLE batch sequential; otherwise all calls start in parallel (Promise.all).
// Kept local so the test does not depend on private/non-exported pi internals.
async function executeBatch(calls) {
  if (calls.some(({ tool }) => tool.executionMode === "sequential")) {
    const results = [];
    for (const { run } of calls) results.push(await run());
    return results;
  }
  return Promise.all(calls.map(({ run }) => run()));
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

for (const firstAction of ["answer", "Esc"]) {
  test(`foreground batch: first ${firstAction}, then second dialog, then batch completes`, async () => {
    let tool;
    registerAskUserQuestion({ registerTool(def) { tool = def; } });
    const events = [];
    const dialogs = [];
    const pending = new Set();
    let visible;
    const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
    const ctx = { hasUI: true, ui: {
      custom(factory) {
        const id = dialogs.length;
        events.push(`open:${id}`);
        // Legacy pi has one non-overlay slot. Replacing it does NOT resolve
        // its old promise; only the visible component receives keyboard input.
        return new Promise((resolve) => {
          pending.add(id);
          const component = factory({}, theme, {}, (result) => {
            pending.delete(id);
            events.push(`close:${id}`);
            resolve(result);
          });
          dialogs.push(component);
          visible = component;
        });
      },
    } };
    const calls = [0, 1].map((id) => ({ tool, run: async () => {
      const result = await tool.execute(`call-${id}`, {
        question: `Question ${id}?`, options: ["Yes", "No"], background: false,
      }, undefined, undefined, ctx);
      events.push(`settled:${id}`);
      return result;
    } }));
    const batch = executeBatch(calls);
    let timer;
    try {
      await nextTurn();
      assert.deepEqual(events, ["open:0"], "second dialog must wait for first to settle");
      visible.handleInput(firstAction === "Esc" ? "\x1b" : "1");
      await nextTurn();
      assert.deepEqual(events, ["open:0", "close:0", "settled:0", "open:1"]);
      visible.handleInput("2");
      const results = await Promise.race([batch, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("batch left an unsettled tool promise")), 500);
      })]);
      assert.equal(results.length, 2);
      assert.equal(results[0].details.cancelled, firstAction === "Esc");
      assert.equal(results[0].details.answers[0].status, firstAction === "Esc" ? "cancelled" : "answered");
      assert.equal(results[1].details.answers[0].answer, "No");
      assert.deepEqual(events.slice(-2), ["close:1", "settled:1"]);
      assert.equal(pending.size, 0, "no unresolved dialog promises");
    } finally {
      clearTimeout(timer);
      // Also clean up orphaned dialogs if a regression starts them in parallel.
      for (let id = 0; id < dialogs.length; id++) {
        if (pending.has(id)) dialogs[id].handleInput("\x1b");
      }
      await batch;
    }
  });
}
