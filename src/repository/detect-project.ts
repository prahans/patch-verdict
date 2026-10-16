import type { Sandbox } from "e2b";

import { readSandboxFile, runSandboxCommand } from "../sandbox/e2b.js";
import { RepositoryPreparationError } from "./errors.js";

import type { PackageManager, ProjectProfile, TestFramework, RepositoryRequest } from "./types.js";

type PackageJson = {
  packageManager?: string;

  scripts?: Record<string, string>;

  dependencies?: Record<string, string>;

  devDependencies?: Record<string, string>;
};

async function readOptionalFile(
  sandbox: Sandbox,
  path: string,
): Promise<string | null> {
  try {
    return await readSandboxFile(sandbox, path);
  } catch {
    return null;
  }
}

function parsePackageJson(contents: string): PackageJson {
  try {
    return JSON.parse(contents) as PackageJson;
  } catch {
    throw new Error("Repository package.json is not valid JSON.");
  }
}

function detectPackageManager(
  packageJson: PackageJson,
  hasPnpmLock: boolean,
  hasNpmLock: boolean,
): PackageManager {
  const declared = packageJson.packageManager;

  if (declared?.startsWith("pnpm@")) {
    if (!hasPnpmLock) {
      throw new Error(
        "Repository declares pnpm but pnpm-lock.yaml is missing.",
      );
    }

    return "pnpm";
  }

  if (declared?.startsWith("npm@")) {
    if (!hasNpmLock) {
      throw new Error(
        "Repository declares npm but package-lock.json is missing.",
      );
    }

    return "npm";
  }

  if (hasPnpmLock && hasNpmLock) {
    throw new Error(
      "Repository contains both pnpm-lock.yaml and package-lock.json. Package manager is ambiguous.",
    );
  }

  if (hasPnpmLock) {
    return "pnpm";
  }

  if (hasNpmLock) {
    return "npm";
  }

  throw new Error(
    "Unsupported repository: PatchVerdict currently requires pnpm-lock.yaml or package-lock.json.",
  );
}

function detectTestFramework(packageJson: PackageJson): TestFramework {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  const testScript = packageJson.scripts?.test ?? "";

  if (testScript.includes("vitest")) {
    return "vitest";
  }

  if (testScript.includes("jest")) {
    return "jest";
  }

  const hasVitest = typeof dependencies.vitest === "string";

  const hasJest = typeof dependencies.jest === "string";

  if (hasVitest && !hasJest) {
    return "vitest";
  }

  if (hasJest && !hasVitest) {
    return "jest";
  }

  return "unknown";
}

function getInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm install --frozen-lockfile";

    case "npm":
      return "npm ci --no-audit --no-fund";
  }
}

function getFullSuiteCommand(
  packageManager: PackageManager,
  packageJson: PackageJson,
): string {
  if (!packageJson.scripts?.test) {
    throw new Error(
      'Unsupported repository: package.json does not define a "test" script.',
    );
  }

  return packageManager === "pnpm" ? "pnpm test" : "npm test";
}

export async function detectProject(
  sandbox: Sandbox,
  projectRoot: string,
  request?: RepositoryRequest,
): Promise<ProjectProfile> {
  if (request?.mode === "THIRD_PARTY_JS_TS") {
    const tree = await runSandboxCommand(sandbox, "git ls-tree -rz --full-tree HEAD", projectRoot);
    if (tree.exitCode !== 0 || tree.stdout.length > 2_000_000) {
      throw new RepositoryPreparationError("PREPARATION_FAILED", "Could not safely inspect the repository file tree.");
    }
    const entries = tree.stdout.split("\0").filter(Boolean).map((entry) => {
      const match = /^(\d{6}) (blob|commit) [a-f0-9]+\t(.+)$/s.exec(entry);
      if (!match?.[1] || !match[3]) throw new RepositoryPreparationError("UNSUPPORTED_REPOSITORY", "Repository contains an unsupported Git tree entry.");
      return { mode: match[1], path: match[3] };
    });
    if (entries.some((entry) => !["100644", "100755"].includes(entry.mode) || /[\0\r\n\\]/.test(entry.path))) {
      throw new RepositoryPreparationError("UNSUPPORTED_REPOSITORY", "Repositories with symlinks, submodules, or unsupported Git modes/paths are not supported yet.");
    }
    const paths = entries.map((entry) => entry.path);
    if (!paths.includes("package.json")) throw new RepositoryPreparationError("UNSUPPORTED_REPOSITORY", "A root package.json is required.");
    const contents = await readSandboxFile(sandbox, `${projectRoot}/package.json`);
    return analyzeStrictProject(contents, paths, request);
  }
  const packageJsonPath = `${projectRoot}/package.json`;

  const packageJsonContents = await readOptionalFile(sandbox, packageJsonPath);

  if (!packageJsonContents) {
    throw new Error("Unsupported repository: package.json was not found.");
  }

  const packageJson = parsePackageJson(packageJsonContents);

  const [pnpmLock, npmLock] = await Promise.all([
    readOptionalFile(sandbox, `${projectRoot}/pnpm-lock.yaml`),

    readOptionalFile(sandbox, `${projectRoot}/package-lock.json`),
  ]);

  const packageManager = detectPackageManager(
    packageJson,
    pnpmLock !== null,
    npmLock !== null,
  );

  const testFramework = detectTestFramework(packageJson);

  const installCommand = getInstallCommand(packageManager);

  const fullSuiteCommand = getFullSuiteCommand(packageManager, packageJson);

  return {
    packageManager,
    testFramework,
    installCommand,
    fullSuiteCommand,
  };
}

/** Pure, bounded preflight decisions. Repository metadata never decides success. */
export function analyzeStrictProject(
  contents: string,
  trackedPaths: string[],
  request: Pick<RepositoryRequest, "targetBranch" | "expectedCommit"> = {},
): ProjectProfile {
  const unsupported = (message: string): never => { throw new RepositoryPreparationError("UNSUPPORTED_REPOSITORY", message); };
  if (contents.length > 256_000) unsupported("The root package.json exceeds the supported size limit.");
  let raw: unknown;
  try { raw = JSON.parse(contents); } catch { return unsupported("The root package.json is invalid JSON."); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return unsupported("The root package.json must be an object.");
  const pkg = raw as Record<string, unknown>;
  const files = new Set(trackedPaths);
  if ("workspaces" in pkg || ["pnpm-workspace.yaml", "pnpm-workspace.yml", "lerna.json", "nx.json"].some((name) => files.has(name)) ||
    trackedPaths.some((name) => name !== "package.json" && name.endsWith("/package.json"))) {
    unsupported("This repository uses a workspace or multi-package layout that PatchVerdict does not safely support yet.");
  }
  if (["yarn.lock", "bun.lock", "bun.lockb"].some((name) => files.has(name))) unsupported("Only npm and pnpm repositories are supported; Yarn and Bun lockfiles are unsupported.");
  const hasNpm = files.has("package-lock.json");
  const hasPnpm = files.has("pnpm-lock.yaml");
  if (hasNpm === hasPnpm) unsupported("Exactly one supported npm or pnpm lockfile is required.");
  const packageManager: PackageManager = hasPnpm ? "pnpm" : "npm";
  if (pkg.packageManager !== undefined && (typeof pkg.packageManager !== "string" || !new RegExp(`^${packageManager}@[0-9]`).test(pkg.packageManager))) {
    unsupported("The packageManager declaration must match the repository lockfile and use npm or pnpm.");
  }
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const dependencies = { ...record(pkg.dependencies), ...record(pkg.devDependencies) };
  const scripts = record(pkg.scripts);
  const script = scripts.test;
  if (typeof script !== "string" || !script.trim() || script.length > 4000) return unsupported("A usable bounded root test script is required.");
  if (/\b(?:playwright|cypress|docker(?:-compose)?|bun|yarn)\b/i.test(script) || "@playwright/test" in dependencies || "cypress" in dependencies) {
    unsupported("Browser/E2E, Docker, Yarn, and Bun verification are not supported yet.");
  }
  const frameworks = (["vitest", "jest"] as const).filter((framework) => typeof dependencies[framework] === "string" && new RegExp(`(?:^|\\s)${framework}(?:\\s|$)`).test(script));
  if (frameworks.length !== 1) unsupported("The test script must use exactly one repository-installed supported framework: Vitest or Jest.");
  if (!trackedPaths.some((name) => /\.(?:[cm]?[jt]s|[jt]sx)$/i.test(name) && !/(?:^|\/)(?:__tests__|tests?|specs?|\.github)\//i.test(name) && !/\.(?:test|spec|config|setup)\./i.test(name) && !/\.d\.[cm]?ts$/i.test(name))) {
    unsupported("No supported JavaScript or TypeScript production source was found.");
  }
  return {
    packageManager,
    testFramework: frameworks[0]!,
    languageFamily: "javascript-typescript",
    projectKind: "single-package",
    ...(request.targetBranch !== undefined && { targetBranch: request.targetBranch }),
    ...(request.expectedCommit !== undefined && { baseCommit: request.expectedCommit.toLowerCase() }),
    installCommand: packageManager === "pnpm" ? "pnpm install --frozen-lockfile --config.engine-strict=true" : "npm ci --no-audit --no-fund --engine-strict",
    fullSuiteCommand: packageManager === "pnpm" ? "pnpm test" : "npm test",
  };
}
