// Node ESM loader that lets `node tests/*.test.mjs` run on Node 20, which
// predates native type stripping (--experimental-strip-types landed in
// 22.6). tests/run-all.mjs only registers this loader when the running node
// cannot strip types itself.
//
// .ts sources are transpiled with TypeScript (devDependency) preserving ESM;
// extensionless relative specifiers and the TS-ESM "./x.js" → "./x.ts"
// convention are resolved by hand.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import ts from "typescript";

function resolveTsFile(specifier, parentURL) {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
  const base = path.dirname(fileURLToPath(parentURL));
  const clean = specifier.endsWith(".js") ? specifier.slice(0, -3) : specifier;
  for (const cand of [clean + ".ts", clean + "/index.ts", specifier]) {
    const p = path.resolve(base, cand);
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const tsUrl = context.parentURL && resolveTsFile(specifier, context.parentURL);
    if (tsUrl) return { url: tsUrl, shortCircuit: true };
    throw err;
  }
}

export async function load(url, context, nextLoad) {
  if (url.endsWith(".ts")) {
    const filename = fileURLToPath(url);
    const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: false,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
