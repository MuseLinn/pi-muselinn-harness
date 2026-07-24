// ============================================================
// Tool Policy — tests for evaluate logic
// ============================================================

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("tool-policy evaluate", () => {
  it("allows tool when no restrictions", async () => {
    const { isToolActive, isToolActiveComposed } = await import("../packages/core/tool-policy/evaluate.ts");
    assert.ok(isToolActive("Read", {}));
    assert.ok(isToolActiveComposed("Read", { profile: {} }));
  });

  it("blocks tool on allow-list when name not included", async () => {
    const { isToolActive } = await import("../packages/core/tool-policy/evaluate.ts");
    assert.ok(!isToolActive("Write", { tools: ["Read", "Grep"] }));
    assert.ok(isToolActive("Read", { tools: ["Read", "Grep"] }));
  });

  it("blocks tool on deny-list", async () => {
    const { isToolActive } = await import("../packages/core/tool-policy/evaluate.ts");
    assert.ok(!isToolActive("Bash", { disallowedTools: ["Bash"] }));
    assert.ok(isToolActive("Read", { disallowedTools: ["Bash"] }));
  });

  it("allow-list takes precedence over deny-list", async () => {
    const { isToolActive } = await import("../packages/core/tool-policy/evaluate.ts");
    // In tools but also in disallowedTools: deny wins
    assert.ok(!isToolActive("Bash", { tools: ["Read", "Bash"], disallowedTools: ["Bash"] }));
  });

  it("empty tools array blocks everything", async () => {
    const { isToolActive } = await import("../packages/core/tool-policy/evaluate.ts");
    assert.ok(!isToolActive("Read", { tools: [] }));
    assert.ok(!isToolActive("Write", { tools: [] }));
  });

  it("undefined tools means all allowed", async () => {
    const { isToolActive } = await import("../packages/core/tool-policy/evaluate.ts");
    assert.ok(isToolActive("Read", { tools: undefined }));
    assert.ok(isToolActive("Bash", { tools: undefined }));
  });

  it("session disabled layer blocks tool", async () => {
    const { isToolActiveComposed } = await import("../packages/core/tool-policy/evaluate.ts");
    assert.ok(!isToolActiveComposed("Bash", {
      profile: {},
      sessionDisabled: ["Bash"],
    }));
    assert.ok(isToolActiveComposed("Read", {
      profile: {},
      sessionDisabled: ["Bash"],
    }));
  });

  it("glob pattern matching (mcp__*)", async () => {
    const { isToolActive } = await import("../packages/core/tool-policy/evaluate.ts");
    // MCP glob allow
    assert.ok(isToolActive("mcp__github__listPRs", { tools: ["mcp__github__*"] }));
    assert.ok(!isToolActive("mcp__slack__sendMsg", { tools: ["mcp__github__*"] }));
    // MCP glob deny
    assert.ok(!isToolActive("mcp__github__listPRs", { disallowedTools: ["mcp__github__*"] }));
  });

  it("resolveActiveToolNames returns undefined when no restriction", async () => {
    const { resolveActiveToolNames } = await import("../packages/core/tool-policy/evaluate.ts");
    assert.equal(resolveActiveToolNames({}), undefined);
    assert.deepEqual(resolveActiveToolNames({ tools: ["Read"] }), ["Read"]);
  });

  it("findInvalidToolPatterns detects unknown tools", async () => {
    const { findInvalidToolPatterns } = await import("../packages/core/tool-policy/evaluate.ts");
    const known = new Set(["Read", "Write", "Bash"]);
    const result = findInvalidToolPatterns(["Read", "FakeTool", "mcp__*"], (n) => known.has(n));
    assert.equal(result.length, 1);
    assert.equal(result[0].pattern, "FakeTool");
  });
});

describe("tool-policy service", () => {
  it("isActive reflects setProfilePolicy", async () => {
    const { ToolPolicyService } = await import("../packages/core/tool-policy/index.ts");
    const svc = new ToolPolicyService(new Set(["Read", "Write", "Bash"]));
    assert.ok(svc.isActive("Read"));
    svc.setProfilePolicy({ tools: ["Read"] });
    assert.ok(svc.isActive("Read"));
    assert.ok(!svc.isActive("Write"));
    svc.clearProfilePolicy();
    assert.ok(svc.isActive("Write"));
  });

  it("sessionDisabled overrides profile", async () => {
    const { ToolPolicyService } = await import("../packages/core/tool-policy/index.ts");
    const svc = new ToolPolicyService(new Set(["Read", "Write"]));
    svc.setSessionDisabled(["Read"]);
    assert.ok(!svc.isActive("Read"));
    svc.clearSessionDisabled();
    assert.ok(svc.isActive("Read"));
  });

  it("reset clears all policy state", async () => {
    const { ToolPolicyService } = await import("../packages/core/tool-policy/index.ts");
    const svc = new ToolPolicyService(new Set(["Read"]));
    svc.setProfilePolicy({ tools: ["Read"] });
    svc.setSessionDisabled(["Read"]);
    svc.reset();
    assert.ok(svc.isActive("Read"));
  });
});
