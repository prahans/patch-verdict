import { z } from "zod";
import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";
import { runSandboxCommand } from "../sandbox/e2b.js";
type RunTestOutput = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const RunTestInputSchema = z.object({
  testName: z.string().trim().min(1).max(200),
});

const GENERIC_TEST_SELECTORS = new Set([
  "test",
  "tests",
  "spec",
  "specs",
  "describe",
  "it",
  "all",
  "*",
  ".",
  ".*",
  ".+",
  "^.*$",
  "^.+$",
]);

function normalizeTestName(testName: string) {
  const safeName = testName.replace(/["\\$`]/g, "").trim();

  if (!safeName) {
    throw new Error(
      "run_test requires a non-empty test name after sanitization.",
    );
  }

  if (GENERIC_TEST_SELECTORS.has(safeName.toLowerCase())) {
    throw new Error(
      `run_test rejected overly broad test selector "${safeName}". ` +
        "Use a specific test or suite name observed in repository evidence.",
    );
  }

  return safeName;
}

const PROJECT_ROOT = "/tmp/patchverdict";

export async function runTestTool(
  sandbox: Sandbox,
  input: unknown,
): Promise<ToolResult<RunTestOutput>> {
  try {
    const parsed = RunTestInputSchema.parse(input);

    const safeName = normalizeTestName(parsed.testName);

    const command = `npx vitest run -t "${safeName}"`;

    const evidence = await runSandboxCommand(sandbox, command, PROJECT_ROOT);

    return {
      ok: true,
      data: evidence,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown run_test error",
    };
  }
}
