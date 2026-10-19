import path from "node:path";
import { RepositoryPreparationError } from "./errors.js";

const unsupported = (message: string): never => {
  throw new RepositoryPreparationError("UNSUPPORTED_REPOSITORY", message);
};
const setupKeys = new Set([
  "setupFiles",
  "setupFilesAfterEnv",
  "globalSetup",
  "globalTeardown",
  "testEnvironment",
]);
type Token = { kind: "string" | "word" | "symbol"; value: string };

/** A deliberately small declarative config grammar; never execute repository config. */
function tokens(source: string): Token[] {
  if (source.length > 128_000)
    return unsupported(
      "Verification configuration exceeds the supported size limit.",
    );
  const output: Token[] = [];
  for (let i = 0; i < source.length; ) {
    const char = source[i]!;
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i + 2);
      i = end < 0 ? source.length : end + 1;
      continue;
    }
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      if (end < 0)
        return unsupported("Unterminated verification configuration comment.");
      i = end + 2;
      continue;
    }
    if (char === "'" || char === '"') {
      const quote = char;
      let value = "";
      let closed = false;
      i++;
      while (i < source.length) {
        const next = source[i++]!;
        if (next === quote) {
          closed = true;
          break;
        }
        if (next === "\\") {
          const escaped = source[i++];
          if (!escaped || !["\\", "'", '"', "/"].includes(escaped))
            return unsupported(
              "Escaped verification configuration values are not supported yet.",
            );
          value += escaped;
        } else {
          if (next === "\r" || next === "\n")
            return unsupported("Invalid verification configuration string.");
          value += next;
        }
      }
      if (!closed)
        return unsupported("Unterminated verification configuration string.");
      output.push({ kind: "string", value });
      continue;
    }
    const word = /^[A-Za-z_$][\w$]*|^-?\d+(?:\.\d+)?/.exec(source.slice(i));
    if (word) {
      output.push({ kind: "word", value: word[0] });
      i += word[0].length;
      continue;
    }
    if ("{}[]():,;.=*".includes(char)) {
      output.push({ kind: "symbol", value: char });
      i++;
      continue;
    }
    return unsupported(
      "Dynamic verification configuration is not supported yet; use a declarative Vitest/Jest configuration.",
    );
  }
  return output;
}

export function parseStaticVerificationConfig(source: string): {
  config: Record<string, unknown>;
  imports: string[];
} {
  const items = tokens(source);
  let index = 0;
  const imports: string[] = [];
  const take = (expected: string) => {
    if (items[index++]?.value !== expected)
      unsupported("Dynamic verification configuration is not supported yet.");
  };
  while (items[index]?.value === "import") {
    index++;
    if (items[index]?.value === "(")
      unsupported("Dynamic verification imports are not supported yet.");
    let module: Token | undefined;
    while (index < items.length) {
      const token = items[index++];
      if (token?.kind === "string") {
        module = token;
        break;
      }
      if (token?.value === ";" || token?.value === "export")
        unsupported("Unsupported verification configuration import.");
    }
    if (!module) unsupported("Unsupported verification configuration import.");
    imports.push(module!.value);
    if (items[index]?.value === ";") index++;
  }
  if (items[index]?.value === "export") {
    take("export");
    take("default");
  } else {
    take("module");
    take(".");
    take("exports");
    take("=");
  }
  function value(depth = 0): unknown {
    if (depth > 20)
      return unsupported("Verification configuration nesting is too deep.");
    const token = items[index++];
    if (!token) return unsupported("Incomplete verification configuration.");
    if (token.kind === "string") return token.value;
    if (token.value === "true" || token.value === "false")
      return token.value === "true";
    if (token.value === "null") return null;
    if (/^-?\d+(?:\.\d+)?$/.test(token.value)) return Number(token.value);
    if (token.value === "defineConfig" && depth === 0) {
      take("(");
      const result = value(depth + 1);
      take(")");
      return result;
    }
    if (token.value === "[") {
      const values: unknown[] = [];
      while (items[index]?.value !== "]") {
        values.push(value(depth + 1));
        if (items[index]?.value !== ",") break;
        index++;
      }
      take("]");
      return values;
    }
    if (token.value === "{") {
      const object: Record<string, unknown> = Object.create(null);
      while (items[index]?.value !== "}") {
        const key = items[index++];
        if (
          !key ||
          !["word", "string"].includes(key.kind) ||
          Object.hasOwn(object, key.value)
        )
          return unsupported(
            "Computed or duplicate verification configuration properties are unsupported.",
          );
        take(":");
        object[key.value] = value(depth + 1);
        if (items[index]?.value !== ",") break;
        index++;
      }
      take("}");
      return object;
    }
    return unsupported(
      "Dynamic verification configuration values are not supported yet.",
    );
  }
  const config = value();
  if (items[index]?.value === "as" && items[index + 1]?.value === "const")
    index += 2;
  if (items[index]?.value === "satisfies" && items[index + 1]?.kind === "word")
    index += 2;
  if (items[index]?.value === ";") index++;
  if (
    index !== items.length ||
    !config ||
    typeof config !== "object" ||
    Array.isArray(config)
  )
    unsupported(
      "Verification configuration must export a single declarative object.",
    );
  return { config: config as Record<string, unknown>, imports };
}

export async function collectProtectedPaths(
  trackedPaths: string[],
  packageJson: string,
  read: (relativePath: string) => Promise<string>,
): Promise<string[]> {
  const tracked = new Set(trackedPaths);
  const protectedPaths = new Set<string>();
  const pending: string[] = [];
  const pkg = JSON.parse(packageJson) as Record<string, unknown>;
  const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const declaredDependencies = {
    ...asRecord(pkg.dependencies),
    ...asRecord(pkg.devDependencies),
  };
  const supportsTsJestPreset =
    typeof declaredDependencies["ts-jest"] === "string";
  const extensionCandidates = [
    "",
    ".ts",
    ".js",
    ".mts",
    ".mjs",
    ".cts",
    ".cjs",
    ".tsx",
    ".jsx",
    "/index.ts",
    "/index.js",
  ];
  function register(specifier: string, relativeTo = ".", required = true) {
    let normalized = specifier.replace(/^<rootDir>\//, "");
    if (specifier.startsWith("<rootDir>/")) relativeTo = ".";
    if (path.posix.isAbsolute(normalized) || /[\0\r\n\\]/.test(normalized))
      unsupported(
        "Verification setup must use safe repository-relative paths.",
      );
    normalized = path.posix.normalize(path.posix.join(relativeTo, normalized));
    if (
      normalized.startsWith("../") ||
      normalized === ".." ||
      normalized.split("/").includes(".git")
    )
      unsupported("Verification setup escapes the repository.");
    const candidates = extensionCandidates.map((extension) => normalized + extension);
    if (/\.[cm]?js$/.test(normalized)) candidates.push(normalized.replace(/js$/, "ts"));
    const resolved = candidates.find((candidate) => tracked.has(candidate));
    if (!resolved) {
      if (required)
        unsupported(
          "A verification setup/configuration dependency could not be resolved safely.",
        );
      return;
    }
    if (!protectedPaths.has(resolved)) {
      protectedPaths.add(resolved);
      pending.push(resolved);
    }
  }
  function inspectConfig(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "preset") {
        // A plain ts-jest preset is common in otherwise single-package Jest
        // TypeScript repositories. It is installed from the lockfile and lives
        // in node_modules, which the repair agent cannot edit. Keep arbitrary
        // presets fail-closed because they may inherit unknown configuration.
        if (nested === "ts-jest" && supportsTsJestPreset) continue;
        unsupported(
          "Only the repository-installed ts-jest preset is supported; arbitrary inherited Jest presets are not supported yet.",
        );
      }
      if (
        [
          "root",
          "rootDir",
          "projects",
          "workspace",
          "workspaces",
          "extends",
        ].includes(key)
      )
        unsupported(
          "Relocated, inherited, or multi-project test configuration is not supported yet.",
        );
      if (setupKeys.has(key)) {
        const entries = Array.isArray(nested) ? nested : [nested];
        if (entries.some((entry) => typeof entry !== "string"))
          unsupported("Verification setup paths must be static strings.");
        for (const entry of entries as string[]) {
          if (
            key === "testEnvironment" &&
            ["node", "jsdom", "happy-dom"].includes(entry)
          )
            continue;
          register(entry);
        }
      } else inspectConfig(nested);
    }
  }
  if (pkg.jest !== undefined) {
    if (!pkg.jest || typeof pkg.jest !== "object" || Array.isArray(pkg.jest)) unsupported("The package.json Jest configuration must be a declarative object.");
    inspectConfig(pkg.jest);
  }
  const configurations = trackedPaths.filter((file) =>
    /^(?:vitest|vite|jest)\.config\.(?:[cm]?[jt]s|json)$/.test(file),
  );
  for (const configPath of configurations) {
    protectedPaths.add(configPath);
    const source = await read(configPath);
    if (source.length > 128_000) unsupported("Verification configuration exceeds the supported size limit.");
    let parsed: { config: Record<string, unknown>; imports: string[] };
    try { parsed = configPath.endsWith(".json") ? { config: JSON.parse(source) as Record<string, unknown>, imports: [] } : parseStaticVerificationConfig(source); }
    catch (error) { if (error instanceof RepositoryPreparationError) throw error; return unsupported("Verification configuration could not be parsed safely."); }
    inspectConfig(parsed.config);
    for (const specifier of parsed.imports)
      if (specifier.startsWith("."))
        register(specifier, path.posix.dirname(configPath));
  }
  // Protect the setup/config import closure. Dynamic import paths cannot be
  // classified safely and must not become editable production candidates.
  for (let index = 0; index < pending.length; index++) {
    if (pending.length > 100)
      unsupported(
        "Verification setup dependency graph exceeds the supported limit.",
      );
    const file = pending[index]!;
    const source = await read(file);
    if (source.length > 128_000)
      unsupported("Verification setup file exceeds the supported size limit.");
    // This is intentionally conservative: a nonliteral loader in setup might
    // select any source file as verification infrastructure.
    for (const loader of source.matchAll(/\b(?:require|import)\s*\(([^)]*)\)/g)) {
      if (!/^\s*(['"])[^'"\r\n]+\1\s*$/.test(loader[1] ?? "")) unsupported("Dynamic verification setup imports are not supported yet.");
    }
    const imports = source.matchAll(
      /\b(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"]([^'"\r\n]+)['"]/g,
    );
    for (const match of imports)
      if (match[1]?.startsWith("."))
        register(match[1], path.posix.dirname(file));
  }
  return [...protectedPaths].sort();
}
