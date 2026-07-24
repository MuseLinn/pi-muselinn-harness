// ============================================================
// Agent File — tests for parse, discovery, roots
// ============================================================

import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

// ── Helpers ────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "af-test-"));
}

function write(root, file, content) {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf-8");
}

// ── parse ──────────────────────────────────────────────────────────

describe("agent-file parse", () => {
  it("parses valid frontmatter", async () => {
    const { parseAgentFile } = await import("../packages/core/agent-file/parse.ts");
    const dir = tmpDir();
    write(dir, "test-agent.md", [
      "---",
      "name: test-agent",
      "description: A test agent",
      "---",
      "You are a test agent.",
    ].join("\n"));
    const result = parseAgentFile(path.join(dir, "test-agent.md"), "user");
    assert.ok(result !== null);
    assert.equal(result.name, "test-agent");
    assert.equal(result.description, "A test agent");
    assert.equal(result.prompt, "You are a test agent.");
    assert.equal(result.source, "user");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("derives name from filename when missing", async () => {
    const { parseAgentFile } = await import("../packages/core/agent-file/parse.ts");
    const dir = tmpDir();
    write(dir, "my-custom-agent.md", [
      "---",
      "description: No name field",
      "---",
      "Hello",
    ].join("\n"));
    const result = parseAgentFile(path.join(dir, "my-custom-agent.md"), "project");
    assert.ok(result !== null);
    assert.equal(result.name, "my-custom-agent");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects invalid name", async () => {
    const { parseAgentFile } = await import("../packages/core/agent-file/parse.ts");
    const dir = tmpDir();
    write(dir, "Bad Name!.md", [
      "---",
      "name: Bad Name!",
      "description: Invalid",
      "---",
      "Body",
    ].join("\n"));
    const result = parseAgentFile(path.join(dir, "Bad Name!.md"), "user");
    assert.equal(result, null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects missing description", async () => {
    const { parseAgentFile } = await import("../packages/core/agent-file/parse.ts");
    const dir = tmpDir();
    write(dir, "no-desc.md", [
      "---",
      "name: no-desc",
      "---",
      "Body",
    ].join("\n"));
    const result = parseAgentFile(path.join(dir, "no-desc.md"), "user");
    assert.equal(result, null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parses tool lists from frontmatter", async () => {
    const { parseAgentFile } = await import("../packages/core/agent-file/parse.ts");
    const dir = tmpDir();
    write(dir, "gated.md", [
      "---",
      "name: gated",
      "description: Gated agent",
      "tools:",
      "  - Read",
      "  - Grep",
      "disallowedTools:",
      "  - Bash",
      "subagents:",
      "  - coder",
      "---",
      "Prompt body",
    ].join("\n"));
    const result = parseAgentFile(path.join(dir, "gated.md"), "project");
    assert.ok(result !== null);
    assert.deepEqual(result.tools, ["Read", "Grep"]);
    assert.deepEqual(result.disallowedTools, ["Bash"]);
    assert.deepEqual(result.subagents, ["coder"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parses SYSTEM.md override", async () => {
    const { parseSystemMd } = await import("../packages/core/agent-file/parse.ts");
    const dir = tmpDir();
    write(dir, "SYSTEM.md", [
      "---",
      "description: Custom default",
      "---",
      "You are my custom agent.",
    ].join("\n"));
    const result = parseSystemMd(path.join(dir, "SYSTEM.md"));
    assert.ok(result !== null);
    assert.equal(result.description, "Custom default");
    assert.equal(result.prompt, "You are my custom agent.");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ── roots ──────────────────────────────────────────────────────────

describe("agent-file roots", () => {
  it("collectRoots includes user and project scopes", async () => {
    const { collectRoots } = await import("../packages/core/agent-file/roots.ts");
    const dir = tmpDir();
    // Project scope: .pi/agents under the project root
    fs.mkdirSync(path.join(dir, ".pi", "agents"), { recursive: true });
    // User scope: point KIMI_AGENT_DIR to a directory under temp
    const userAgentDir = path.join(dir, "user", "agent");
    fs.mkdirSync(path.join(userAgentDir, "agents"), { recursive: true });
    const prev = process.env.KIMI_AGENT_DIR;
    process.env.KIMI_AGENT_DIR = userAgentDir;
    try {
      const roots = collectRoots(dir);
      assert.ok(roots.length > 0);
      const hasProject = roots.some((r) => r.source === "project");
      assert.ok(hasProject, "should have project roots");
      const hasUser = roots.some((r) => r.source === "user");
      assert.ok(hasUser, "should have user roots");
    } finally {
      if (prev === undefined) delete process.env.KIMI_AGENT_DIR;
      else process.env.KIMI_AGENT_DIR = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("findProjectRoot finds .git", async () => {
    const { findProjectRoot } = await import("../packages/core/agent-file/roots.ts");
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
    const root = findProjectRoot(dir);
    assert.equal(root, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ── discovery ──────────────────────────────────────────────────────

describe("agent-file discovery", () => {
  it("discovers agent files in roots", async () => {
    const { discoverAgentFiles } = await import("../packages/core/agent-file/discovery.ts");
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, ".pi", "agents"), { recursive: true });
    write(path.join(dir, ".pi", "agents"), "alpha.md", [
      "---",
      "name: alpha",
      "description: Alpha agent",
      "---",
      "Alpha body",
    ].join("\n"));
    write(path.join(dir, ".pi", "agents"), "beta.md", [
      "---",
      "name: beta",
      "description: Beta agent",
      "---",
      "Beta body",
    ].join("\n"));
    const roots = [{ dir: path.join(dir, ".pi", "agents"), source: "project" }];
    const result = discoverAgentFiles(roots);
    assert.equal(result.agents.length, 2);
    assert.equal(result.agents[0].name, "alpha");
    assert.equal(result.agents[1].name, "beta");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deduplicates by name (first wins)", async () => {
    const { discoverAgentFiles } = await import("../packages/core/agent-file/discovery.ts");
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "user-agents"), { recursive: true });
    fs.mkdirSync(path.join(dir, "project-agents"), { recursive: true });
    write(dir, "user-agents/dup.md", [
      "---",
      "name: duplicate",
      "description: User version",
      "---",
      "User",
    ].join("\n"));
    write(dir, "project-agents/dup.md", [
      "---",
      "name: duplicate",
      "description: Project version (should be ignored)",
      "---",
      "Project",
    ].join("\n"));
    const roots = [
      { dir: path.join(dir, "user-agents"), source: "user" },
      { dir: path.join(dir, "project-agents"), source: "project" },
    ];
    const result = discoverAgentFiles(roots);
    assert.equal(result.agents.length, 1);
    assert.equal(result.agents[0].description, "User version");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("skips invalid files gracefully", async () => {
    const { discoverAgentFiles } = await import("../packages/core/agent-file/discovery.ts");
    const dir = tmpDir();
    fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
    write(dir, "agents/valid.md", [
      "---",
      "name: valid",
      "description: I am valid",
      "---",
      "Body",
    ].join("\n"));
    // Invalid: no frontmatter (no description → null)
    write(dir, "agents/invalid.md", "no frontmatter here");
    // Valid because name derived from filename "no-name" and has description
    write(dir, "agents/no-name.md", [
      "---",
      "description: Has description so valid",
      "---",
      "Body",
    ].join("\n"));
    // Invalid: description present but cannot have special chars in derived name
    // Actually this one passes because "missing" is a valid kebab name
    const roots = [{ dir: path.join(dir, "agents"), source: "user" }];
    const result = discoverAgentFiles(roots);
    // valid.md + no-name.md = 2 valid
    assert.equal(result.agents.length, 2);
    const names = result.agents.map(a => a.name).sort();
    assert.deepEqual(names, ["no-name", "valid"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
