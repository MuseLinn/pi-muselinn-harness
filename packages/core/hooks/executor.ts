// ============================================================
// Hooks Executor — spawn hook commands with Kimi Code exit-code semantics
//
//   exit 0          → allow (stdout may be appended to context)
//   exit 2          → block (stderr is the reason)
//   any other code  → fail-open (allow)
//   timeout/crash   → fail-open (allow)
// Additionally, exit-0 stdout containing JSON
//   {"hookSpecificOutput":{"permissionDecision":"deny",
//                           "permissionDecisionReason":"..."}}
// also blocks.
//
// Spawning: Windows runs the command through %COMSPEC% (default cmd.exe)
// via Node's `shell: true` (/d /s /c) — passing the command as an argv
// element instead mangles inner double quotes (cmd strips them before the
// child sees them, turning e.g. node -e "..." into a no-op string literal).
// Other platforms use sh -c. stdin receives the event payload as JSON.
// Timeout kills the child (SIGTERM; on Windows kill() terminates the shell
// process directly — an already-spawned grandchild may outlive the shell).
// ============================================================

import { spawn } from "node:child_process";

export interface HookExecResult {
  /** Process exit code; null when the process failed to spawn or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

export interface HookVerdict {
  blocked: boolean;
  reason?: string;
  /** Context-appendable stdout from an exit-0 hook (plain text, non-JSON). */
  output?: string;
}

/** Cap captured streams so a runaway hook cannot exhaust memory. */
const MAX_STREAM_BYTES = 256 * 1024;

export function runHookCommand(
  command: string,
  stdinJson: string,
  timeoutSec: number,
  cwd: string,
): Promise<HookExecResult> {
  return new Promise<HookExecResult>((resolve) => {
    const isWin = process.platform === "win32";
    let child;
    try {
      if (isWin) {
        // shell: true → %COMSPEC% /d /s /c with Node-managed quoting; argv-style
        // /c passing provably corrupts inner double quotes on Windows.
        child = spawn(command, {
          cwd,
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
          shell: true,
        });
      } else {
        child = spawn("sh", ["-c", command], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: process.env,
        });
      }
    } catch (e: any) {
      resolve({ code: null, stdout: "", stderr: "", timedOut: false, spawnError: e?.message || String(e) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let timedOut = false;
    let settled = false;

    const finish = (result: HookExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
      // Hard fallback: if SIGTERM did not end it (Windows semantics differ),
      // force-kill shortly after so we never hang past the timeout.
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch { /* ignore */ }
      }, 1000).unref?.();
    }, Math.max(1, timeoutSec) * 1000);
    timer.unref?.();

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutTruncated) return;
      stdout += chunk.toString("utf-8");
      if (Buffer.byteLength(stdout) > MAX_STREAM_BYTES) {
        stdout = stdout.slice(0, MAX_STREAM_BYTES);
        stdoutTruncated = true;
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrTruncated) return;
      stderr += chunk.toString("utf-8");
      if (Buffer.byteLength(stderr) > MAX_STREAM_BYTES) {
        stderr = stderr.slice(0, MAX_STREAM_BYTES);
        stderrTruncated = true;
      }
    });

    child.on("error", (e: any) => {
      finish({ code: null, stdout, stderr, timedOut, spawnError: e?.message || String(e) });
    });
    child.on("close", (code: number | null) => {
      finish({ code, stdout, stderr, timedOut });
    });

    // Feed the event payload via stdin, then close so the script can read EOF.
    try {
      child.stdin?.on("error", () => { /* EPIPE when the child exits early — ignore */ });
      child.stdin?.write(stdinJson);
      child.stdin?.end();
    } catch { /* stdin closed already — the close/error event will settle us */ }
  });
}

/**
 * Translate a raw execution result into a verdict using Kimi Code semantics.
 * Everything unexpected (non-zero/non-2 exits, timeouts, spawn failures,
 * crashes) fails open.
 */
export function interpretResult(r: HookExecResult): HookVerdict {
  if (r.timedOut || r.spawnError) return { blocked: false };

  if (r.code === 2) {
    const reason = r.stderr.trim() || "blocked by hook (exit code 2)";
    return { blocked: true, reason };
  }

  if (r.code === 0) {
    const out = r.stdout.trim();
    if (out) {
      // JSON control output: hookSpecificOutput.permissionDecision = "deny" blocks.
      if (out.startsWith("{")) {
        try {
          const parsed = JSON.parse(out);
          const hso = parsed?.hookSpecificOutput;
          if (hso && hso.permissionDecision === "deny") {
            return {
              blocked: true,
              reason: typeof hso.permissionDecisionReason === "string" && hso.permissionDecisionReason
                ? hso.permissionDecisionReason
                : "blocked by hook (permissionDecision: deny)",
            };
          }
          // Valid JSON control output that does not deny → allow, no context text.
          return { blocked: false };
        } catch {
          // Not JSON after all — fall through to plain-text context output.
        }
      }
      return { blocked: false, output: out };
    }
    return { blocked: false };
  }

  // Any other non-zero exit → fail-open.
  return { blocked: false };
}
