import { registerHooks } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const harness = new URL("./ui-harness.mjs", import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation")
      return { url: "patchverdict:test-navigation", shortCircuit: true };
    if (specifier === "patchverdict:test-hooks")
      return { url: "patchverdict:test-hooks", shortCircuit: true };
    if (specifier === "next/link") return nextResolve("next/link.js", context);
    if (specifier.startsWith("@/"))
      specifier = pathToFileURL(path.join(webRoot, specifier.slice(2))).href;
    if (specifier.startsWith(".") || specifier.startsWith("file:")) {
      const url = new URL(specifier, context.parentURL);
      if (!path.extname(url.pathname)) {
        for (const extension of [".ts", ".tsx", ".mjs"]) {
          const candidate = new URL(url);
          candidate.pathname += extension;
          if (existsSync(fileURLToPath(candidate)))
            return nextResolve(candidate.href, context);
        }
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === "patchverdict:test-navigation") {
      return {
        format: "module",
        shortCircuit: true,
        source: `import { navigation } from ${JSON.stringify(harness)}; export const useRouter = () => navigation;`,
      };
    }
    if (url === "patchverdict:test-hooks") {
      return {
        format: "module",
        shortCircuit: true,
        source: `export { useState, useRef, useEffect } from ${JSON.stringify(harness)};`,
      };
    }
    if (url.startsWith("file:") && /\.tsx?(?:\?|$)/.test(url)) {
      let source = readFileSync(fileURLToPath(url), "utf8");
      if (new URL(url).searchParams.has("interactive")) {
        source = source.replace(
          /from\s+["']react["']/g,
          'from "patchverdict:test-hooks"',
        );
      }
      return {
        format: "module",
        shortCircuit: true,
        source: ts.transpileModule(source, {
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
          },
          fileName: fileURLToPath(url),
        }).outputText,
      };
    }
    return nextLoad(url, context);
  },
});
