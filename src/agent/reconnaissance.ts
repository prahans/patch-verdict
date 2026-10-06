import path from "node:path";
import type { Sandbox } from "e2b";

import { readSandboxFile, runSandboxCommand } from "../sandbox/e2b.js";
import type { InvestigationBaselineContext } from "./investigation-context.js";

const DEFAULT_INVENTORY_DEPTH = 5;
const MAX_MODEL_INVENTORY_PATHS = 250;
const MAX_FILE_CONTENT_CHARS = 12_000;

export type ReconnaissanceFileRole =
  | "PACKAGE_MANIFEST"
  | "RUNNER_CONFIG"
  | "TEST_SETUP"
  | "FAILING_FILE";

export type ReconnaissanceFile = {
  path: string;
  roles: ReconnaissanceFileRole[];
  content: string;
  truncated: boolean;
};

export type ReconnaissancePackageSummary = {
  name?: string;
  packageManager?: string;
  testScript?: string;
  testFramework: "vitest" | "jest" | "unknown";
  testFrameworkVersion?: string;
};

export type ReconnaissanceContext = {
  inventory: string[];
  inventoryDepth: number;
  inventoryPreview: string[];
  inventoryTruncated: boolean;

  failingPaths: string[];
  runnerConfigs: string[];
  testSetups: string[];

  packageSummary?: ReconnaissancePackageSummary;

  files: ReconnaissanceFile[];
  preInspectedFiles: string[];
  readFailures: string[];
};

export type ReconnaissanceSummary = {
  inventoryCount: number;
  inventoryDepth: number;
  failingPaths: string[];
  runnerConfigs: string[];
  testSetups: string[];
  packageSummary?: ReconnaissancePackageSummary;
  preInspectedFiles: string[];
  readFailures: string[];
};

type ReconnaissanceRepositoryAccess = {
  listFiles: () => Promise<string[]>;
  readFile: (repositoryRelativePath: string) => Promise<string>;
};

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values.map(normalizePath).filter(Boolean))].sort();
}

function isRunnerConfig(filePath: string) {
  return /(^|\/)(?:vite|vitest|jest|playwright|cypress)\.config\.[^/]+$/i.test(
    normalizePath(filePath),
  );
}

function isTestSetup(filePath: string) {
  const normalized = normalizePath(filePath);

  return (
    /(^|\/)(?:vitest|jest)\.setup\.[^/]+$/i.test(normalized) ||
    /(^|\/)setupTests\.[^/]+$/i.test(normalized)
  );
}

function findFailingPaths(
  inventory: readonly string[],
  baselineOutput: string,
): string[] {
  const normalizedOutput = baselineOutput.replace(/\\/g, "/");

  return uniqueSorted(
    inventory.filter((candidate) => {
      const normalized = normalizePath(candidate);

      if (!normalized) {
        return false;
      }

      return normalizedOutput.includes(normalized);
    }),
  );
}

function summarizePackageJson(
  content: string,
): ReconnaissancePackageSummary | undefined {
  try {
    const parsed = JSON.parse(content) as {
      name?: unknown;
      packageManager?: unknown;
      scripts?: Record<string, unknown>;
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };

    const dependencies = {
      ...parsed.dependencies,
      ...parsed.devDependencies,
    };

    const testScript =
      typeof parsed.scripts?.test === "string"
        ? parsed.scripts.test
        : undefined;

    let testFramework: ReconnaissancePackageSummary["testFramework"] =
      "unknown";

    if (
      testScript?.includes("vitest") ||
      typeof dependencies.vitest === "string"
    ) {
      testFramework = "vitest";
    } else if (
      testScript?.includes("jest") ||
      typeof dependencies.jest === "string"
    ) {
      testFramework = "jest";
    }

    const frameworkDependency =
      testFramework === "vitest"
        ? dependencies.vitest
        : testFramework === "jest"
          ? dependencies.jest
          : undefined;

    return {
      ...(typeof parsed.name === "string" && {
        name: parsed.name,
      }),

      ...(typeof parsed.packageManager === "string" && {
        packageManager: parsed.packageManager,
      }),

      ...(testScript && {
        testScript,
      }),

      testFramework,

      ...(typeof frameworkDependency === "string" && {
        testFrameworkVersion: frameworkDependency,
      }),
    };
  } catch {
    return undefined;
  }
}

function truncateContent(content: string) {
  if (content.length <= MAX_FILE_CONTENT_CHARS) {
    return {
      content,
      truncated: false,
    };
  }

  return {
    content:
      content.slice(0, MAX_FILE_CONTENT_CHARS) +
      "\n\n[PatchVerdict reconnaissance truncated this file for model context]",
    truncated: true,
  };
}

function rolesForPath(input: {
  filePath: string;
  failingPaths: ReadonlySet<string>;
}) {
  const roles: ReconnaissanceFileRole[] = [];

  if (input.filePath === "package.json") {
    roles.push("PACKAGE_MANIFEST");
  }

  if (isRunnerConfig(input.filePath)) {
    roles.push("RUNNER_CONFIG");
  }

  if (isTestSetup(input.filePath)) {
    roles.push("TEST_SETUP");
  }

  if (input.failingPaths.has(input.filePath)) {
    roles.push("FAILING_FILE");
  }

  return roles;
}

export async function buildReconnaissanceContext(input: {
  baseline: InvestigationBaselineContext;
  access: ReconnaissanceRepositoryAccess;
  inventoryDepth?: number;
}): Promise<ReconnaissanceContext> {
  const inventoryDepth = input.inventoryDepth ?? DEFAULT_INVENTORY_DEPTH;

  const inventory = uniqueSorted(await input.access.listFiles());

  const runnerConfigs = inventory.filter(isRunnerConfig);
  const testSetups = inventory.filter(isTestSetup);

  const failingPaths = findFailingPaths(
    inventory,
    input.baseline.outputExcerpt,
  );

  const filesToInspect = uniqueSorted([
    ...(inventory.includes("package.json") ? ["package.json"] : []),
    ...runnerConfigs,
    ...testSetups,
    ...failingPaths,
  ]);

  const failingPathSet = new Set(failingPaths);

  const files: ReconnaissanceFile[] = [];
  const readFailures: string[] = [];
  let packageSummary: ReconnaissancePackageSummary | undefined;

  for (const filePath of filesToInspect) {
    try {
      const rawContent = await input.access.readFile(filePath);

      if (filePath === "package.json") {
        packageSummary = summarizePackageJson(rawContent);
      }

      const truncated = truncateContent(rawContent);

      files.push({
        path: filePath,
        roles: rolesForPath({
          filePath,
          failingPaths: failingPathSet,
        }),
        content: truncated.content,
        truncated: truncated.truncated,
      });
    } catch {
      readFailures.push(filePath);
    }
  }

  const preInspectedFiles = files.map((file) => file.path);

  return {
    inventory,
    inventoryDepth,
    inventoryPreview: inventory.slice(0, MAX_MODEL_INVENTORY_PATHS),
    inventoryTruncated: inventory.length > MAX_MODEL_INVENTORY_PATHS,

    failingPaths,
    runnerConfigs,
    testSetups,

    ...(packageSummary && {
      packageSummary,
    }),

    files,
    preInspectedFiles,
    readFailures,
  };
}

export async function createDeterministicReconnaissance(
  sandbox: Sandbox,
  projectRoot: string,
  baseline: InvestigationBaselineContext,
): Promise<ReconnaissanceContext> {
  return buildReconnaissanceContext({
    baseline,

    inventoryDepth: DEFAULT_INVENTORY_DEPTH,

    access: {
      listFiles: async () => {
        const result = await runSandboxCommand(
          sandbox,
          `find . -maxdepth ${DEFAULT_INVENTORY_DEPTH} -type f -not -path "./node_modules/*" -not -path "./.git/*" | sort`,
          projectRoot,
        );

        if (result.exitCode !== 0) {
          throw new Error(
            result.stderr || "Deterministic reconnaissance could not list repository files.",
          );
        }

        return result.stdout
          .split(/\r?\n/)
          .map(normalizePath)
          .filter(Boolean);
      },

      readFile: async (repositoryRelativePath) =>
        readSandboxFile(
          sandbox,
          path.posix.join(projectRoot, repositoryRelativePath),
        ),
    },
  });
}

export function reconnaissanceForModel(
  context: ReconnaissanceContext,
) {
  return {
    inventoryCount: context.inventory.length,
    inventoryDepth: context.inventoryDepth,
    inventoryPreview: context.inventoryPreview,
    inventoryTruncated: context.inventoryTruncated,

    failingPaths: context.failingPaths,
    runnerConfigs: context.runnerConfigs,
    testSetups: context.testSetups,

    packageSummary: context.packageSummary,

    preInspectedFiles: context.preInspectedFiles,
    readFailures: context.readFailures,

    files: context.files,
  };
}

export function reconnaissanceSummary(
  context: ReconnaissanceContext,
): ReconnaissanceSummary {
  return {
    inventoryCount: context.inventory.length,
    inventoryDepth: context.inventoryDepth,
    failingPaths: context.failingPaths,
    runnerConfigs: context.runnerConfigs,
    testSetups: context.testSetups,
    ...(context.packageSummary && {
      packageSummary: context.packageSummary,
    }),
    preInspectedFiles: context.preInspectedFiles,
    readFailures: context.readFailures,
  };
}
