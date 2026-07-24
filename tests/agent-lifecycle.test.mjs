// ============================================================
// Agent Lifecycle — tests for event bus
// ============================================================

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

describe("agent-lifecycle", () => {
  it("emits created event and tracks active agents", async () => {
    const { AgentLifecycle } = await import("../packages/core/agent-lifecycle/index.ts");
    const lc = new AgentLifecycle();
    lc.emit({ type: "agent.created", agentId: "001", agentType: "coder" });
    assert.equal(lc.getActiveCount(), 1);
    const agents = lc.getActiveAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0].agentId, "001");
    assert.equal(agents[0].type, "agent.created");
  });

  it("disposed event removes from active", async () => {
    const { AgentLifecycle } = await import("../packages/core/agent-lifecycle/index.ts");
    const lc = new AgentLifecycle();
    lc.emit({ type: "agent.created", agentId: "002", agentType: "explore" });
    assert.equal(lc.getActiveCount(), 1);
    lc.emit({ type: "agent.disposed", agentId: "002", agentType: "explore", status: "done" });
    assert.equal(lc.getActiveCount(), 0);
  });

  it("subscribe receives events", async () => {
    const { AgentLifecycle } = await import("../packages/core/agent-lifecycle/index.ts");
    const lc = new AgentLifecycle();
    const received = [];
    const unsub = lc.subscribe((e) => received.push(e));
    lc.emit({ type: "agent.created", agentId: "003", agentType: "coder" });
    assert.equal(received.length, 1);
    assert.equal(received[0].agentId, "003");
    unsub();
    lc.emit({ type: "agent.created", agentId: "004", agentType: "coder" });
    assert.equal(received.length, 1); // unsubscribed, no new events
  });

  it("reset clears all active agents", async () => {
    const { AgentLifecycle } = await import("../packages/core/agent-lifecycle/index.ts");
    const lc = new AgentLifecycle();
    lc.emit({ type: "agent.created", agentId: "005", agentType: "plan" });
    lc.emit({ type: "agent.created", agentId: "006", agentType: "coder" });
    assert.equal(lc.getActiveCount(), 2);
    lc.reset();
    assert.equal(lc.getActiveCount(), 0);
  });

  it("timestamp is set automatically", async () => {
    const { AgentLifecycle } = await import("../packages/core/agent-lifecycle/index.ts");
    const lc = new AgentLifecycle();
    lc.emit({ type: "agent.created", agentId: "007", agentType: "coder" });
    const agents = lc.getActiveAgents();
    assert.ok(agents[0].timestamp > 0);
    assert.ok(agents[0].timestamp <= Date.now());
  });

  it("subscriber errors do not break the bus", async () => {
    const { AgentLifecycle } = await import("../packages/core/agent-lifecycle/index.ts");
    const lc = new AgentLifecycle();
    lc.subscribe(() => { throw new Error("oops"); });
    lc.subscribe((e) => { /* should still receive */ });
    const received = [];
    lc.subscribe((e) => received.push(e));
    lc.emit({ type: "agent.created", agentId: "008", agentType: "coder" });
    assert.equal(received.length, 1);
  });
});
