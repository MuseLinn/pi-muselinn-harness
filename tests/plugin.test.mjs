// plugin manifest parse + discovery unit tests (pure, temp-dir based).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const { parsePluginManifest, discoverPlugins, defaultPluginRoots, PLUGIN_MANIFEST_NAME } =
  await import("../packages/core/plugin/manifest.ts");

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; console.log(`FAIL ${name} ${extra}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-test-"));
const pdir = path.join(tmp, "demo");
fs.mkdirSync(path.join(pdir, "skills", "grep-fu"), { recursive: true });
fs.writeFileSync(path.join(pdir, "skills", "grep-fu", "SKILL.md"), "---\nname: grep-fu\n---\n");
fs.mkdirSync(path.join(pdir, "commands"), { recursive: true });
fs.writeFileSync(path.join(pdir, "commands", "review.md"), "Review the diff.");

// 1. Full manifest parses with resolved paths
const loaded = parsePluginManifest({
  name: "demo",
  version: "0.1.0",
  description: "test",
  skills: ["skills"],
  sessionStart: ["line1", "line2"],
  mcpServers: { srv: { command: "x" } },
  hooks: [{ event: "PreToolUse", matcher: "Bash", command: "./guard.sh", timeout: 10 }],
  commands: { review: "commands/review.md" },
  interface: { panel: true },
}, pdir);
const m = loaded.manifest;
check("name/version", m.name === "demo" && m.version === "0.1.0");
check("skills resolved absolute", m.skills.length === 1 && path.isAbsolute(m.skills[0]));
check("sessionStart array", m.sessionStart.join("|") === "line1|line2");
check("hook kept", m.hooks.length === 1 && m.hooks[0].timeout === 10);
check("command resolved", m.commands.review.endsWith("review.md"));
check("mcp diagnostic", loaded.diagnostics.some((d) => d.includes("mcpServers")));
check("interface diagnostic", loaded.diagnostics.some((d) => d.includes("interface")));

// 2. Missing paths become diagnostics
const bad = parsePluginManifest({ skills: ["nope"], commands: { x: "missing.md" } }, pdir);
check("missing skill dir diagnostic", bad.diagnostics.some((d) => d.includes("skills dir not found")));
check("missing command file diagnostic", bad.diagnostics.some((d) => d.includes("file not found")));

// 3. Invalid shapes never throw
const weird = parsePluginManifest({ hooks: [{ event: "X" }, "junk", { event: "Y", command: "c", matcher: 5 }] }, pdir);
check("bad hooks skipped with diagnostics", weird.manifest.hooks.length === 0 && weird.diagnostics.length >= 3, `hooks=${weird.manifest.hooks.length} diags=${weird.diagnostics.length}`);
check("non-object manifest safe", parsePluginManifest(null, pdir).diagnostics.length > 0);
check("string sessionStart normalized", parsePluginManifest({ sessionStart: "one" }, pdir).manifest.sessionStart[0] === "one");

// 4. Discovery: finds the plugin, skips non-plugin dirs, first-wins dedupe
fs.writeFileSync(path.join(pdir, PLUGIN_MANIFEST_NAME), JSON.stringify({ name: "demo", skills: [] }));
fs.mkdirSync(path.join(tmp, "not-a-plugin"));
const root2 = path.join(tmp, "root2");
fs.mkdirSync(path.join(root2, "demo"), { recursive: true });
fs.writeFileSync(path.join(root2, "demo", PLUGIN_MANIFEST_NAME), JSON.stringify({ name: "demo" }));
const found = discoverPlugins([tmp, root2, path.join(tmp, "missing-root")]);
check("discovers one plugin", found.filter((p) => p.manifest.name === "demo").length === 1);
check("dup name skipped (first-wins)", found.length === 1);
check("missing root tolerated", Array.isArray(found));

// 5. defaultPluginRoots shape
const roots = defaultPluginRoots("/home/u", "/proj");
check("project root first", roots[0] === path.join("/proj", ".pi", "plugins"));
check("user agent dir second", roots[1] === path.join("/home/u", ".pi", "agent", "plugins"));

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
