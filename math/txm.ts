// ============================================================
// Math — txm backend (runtime only, not loaded by unit tests).
//
// txm (https://github.com/thatmagicalcat/txm) is a Rust terminal math
// engine: real 2D cell typesetting (fraction bars, integrals, matrices)
// as Unicode + truecolor ANSI — no image protocol, works in any terminal
// including Windows Terminal / ConPTY. Invoked as a CLI subprocess:
//   txm "<tex>"  →  ANSI string on stdout
//
// Fail-open everywhere: missing binary, timeout, or render error all
// return null so the caller keeps the original LaTeX.
// ============================================================

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const TIMEOUT_MS = Number(process.env.PI_MUSELINN_MATH_TIMEOUT_MS ?? 10000);
const MAX_BUFFER = 4 * 1024 * 1024;

function cacheDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || ".";
  return path.join(home, ".pi", "cache", "muselinn-math");
}

function cacheKey(tex: string): string {
  return createHash("sha256").update(tex, "utf8").digest("hex");
}

// Bounded in-memory layer on top of the disk cache.
const memCache = new Map<string, string>();
const MEM_CACHE_CAP = 200;

let detected: boolean | null = null;

/** One-shot txm availability probe (result cached for the session). */
export async function detectTxm(): Promise<boolean> {
  if (detected !== null) return detected;
  try {
    await execFileAsync("txm", ["--version"], { timeout: 5000 });
    detected = true;
  } catch {
    detected = false;
  }
  return detected;
}

/** Test hook: reset the availability probe + memory cache. */
export function resetTxmCacheForTests(): void {
  detected = null;
  memCache.clear();
}

/**
 * Render a TeX formula to an ANSI string, or null on any failure.
 * Disk-cached at ~/.pi/cache/muselinn-math/<sha256>.ans.
 */
export async function renderFormula(tex: string): Promise<string | null> {
  if (!tex.trim()) return null;
  if (!(await detectTxm())) return null;

  const key = cacheKey(tex);
  const mem = memCache.get(key);
  if (mem !== undefined) return mem;

  const file = path.join(cacheDir(), `${key}.ans`);
  try {
    const cached = fs.readFileSync(file, "utf8");
    if (cached) {
      memCache.set(key, cached);
      return cached;
    }
  } catch { /* cache miss */ }

  let out: string;
  try {
    const result = await execFileAsync("txm", [tex], {
      timeout: TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
    });
    out = result.stdout;
  } catch {
    return null; // render error / timeout — caller keeps the raw LaTeX
  }
  if (!out.trim()) return null;

  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(file, out, "utf8");
  } catch { /* cache write is best-effort */ }
  if (memCache.size >= MEM_CACHE_CAP) {
    memCache.delete(memCache.keys().next().value!);
  }
  memCache.set(key, out);
  return out;
}
