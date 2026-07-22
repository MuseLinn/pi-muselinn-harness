// Portable jiti resolution for the CJS-loader test suites
// (goal/hooks/permission/plan/skills/tui/tui-box). Those suites wrap
// jiti.transform in a local CJS loader; they previously imported jiti from a
// machine-specific absolute path, which breaks CI and other dev machines.
//
// Resolution order:
//   1. repo devDependency (`npm install` — the CI path)
//   2. jiti bundled inside a globally installed @earendil-works/pi-coding-agent
//      (local dev machines that have pi installed)
//   3. globally installed jiti
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function jitiUrl() {
  const req = createRequire(import.meta.url);
  try {
    return pathToFileURL(req.resolve("jiti")).href;
  } catch { /* not installed in the repo — try global locations */ }

  const candidates = [];
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    candidates.push(
      path.join(root, "@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti.cjs"),
      path.join(root, "jiti/lib/jiti.cjs"),
    );
  } catch { /* npm not on PATH */ }
  for (const c of candidates) {
    if (existsSync(c)) return pathToFileURL(c).href;
  }
  throw new Error(
    "Cannot locate jiti. Run `npm install` (it is a devDependency), or install pi globally — @earendil-works/pi-coding-agent bundles jiti."
  );
}
