# Timeout & Output Limit Plan

## Problem
- `bash` commands run by subagents have no timeout → `pi -c 'get_goal'` hung 10+ minutes
- Subagent turns have no per-turn or total timeout
- No output size limit → runaway output fills memory

## Proposal

### Phase 1: Subagent timeout (swarm/subagent.ts)

**runWithModel**: Add `AbortSignal.timeout(ms)` to the createAgentSession call.
- Default timeout: `KIMI_SUBAGENT_TIMEOUT_MS` env var or 10 minutes
- Combined with existing cancel signal via `AbortSignal.any()`

### Phase 2: Background task timeout (task/index.ts)

**BackgroundTaskManager.run()**: Add timeout per task.
- `timeoutMs` parameter (default 600_000 = 10 min)
- When timeout fires, set status to "failed" with "timed_out" stopReason

### Phase 3: Output size limit

**runWithModel subscribe handler**: Add output buffering limit.
- `MAX_OUTPUT_BYTES = 1 * 1024 * 1024` (1MB, matching Kimi Code)
- When exceeded, stop collecting output lines
- Set status to "failed" with "output_limit_exceeded" stopReason

## Implementation Details

### Phase 1 (swarm/subagent.ts):
1. `runWithModel` already has `signal: AbortSignal`
2. Add `const timeoutMs = parseInt(process.env.KIMI_SUBAGENT_TIMEOUT_MS || "600000", 10);`
3. Create `AbortSignal.timeout(timeoutMs)` and combine via `AbortSignal.any([signal, timeoutSignal])`
4. Pass combined signal to `createAgentSession`

### Phase 2 (task/index.ts):
1. `BackgroundTaskEntry` already has `stopReason` field
2. In `run()`: add timeout guard
3. When timeout fires: set `status: "failed"`, `stopReason: "timed_out"`

### Phase 3 (swarm/subagent.ts):
1. In subscribe handler, track total output bytes
2. When `totalBytes > MAX_OUTPUT_BYTES`, skip collecting further output
3. Set task status to "failed" after completion if output limit was exceeded
