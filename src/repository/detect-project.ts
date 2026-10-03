import type { Sandbox } from "e2b";

import { readSandboxFile } from "../sandbox/e2b.js";

import type { PackageManager, ProjectProfile, TestFramework } from "./types.js";

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
): Promise<ProjectProfile> {
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
