// Runs every tests/*.test.mjs in its own node process (sequential, stdio
// inherited) and aggregates exit codes. Pure node-level suites, no model
// quota needed.
//
// TypeScript loading strategy per node version:
//   >= 22.18 / 23+  native type stripping, nothing to do
//   22.6 – 22.17    --experimental-strip-types
//   < 22.6 (20.x)   --loader tests/ts-esm-loader.mjs (TypeScript transpile)
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

const [maj, min] = process.versions.node.split(".").map(Number);
const execArgs =
  maj > 22 || (maj === 22 && min >= 18)
    ? []
    : maj === 22 && min >= 6
      ? ["--experimental-strip-types"]
      : ["--loader", pathToFileURL(path.join(here, "ts-esm-loader.mjs")).href];

let failed = 0;
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [...execArgs, path.join(here, f)], {
    stdio: "inherit",
  });
  if (r.status !== 0) {
    failed++;
    console.error(`--- ${f} exited with code ${r.status}`);
  }
}

console.log(failed ? `\n${failed} suite(s) FAILED` : "\nall suites passed");
process.exit(failed ? 1 : 0);
