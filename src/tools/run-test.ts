import { z } from "zod";
import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";
import { runSandboxCommand } from "../sandbox/e2b.js";

const RunTestInputSchema = z.object({
  testName: z.string().min(1).max(200),
});

type RunTestOutput = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

const PROJECT_ROOT = "/tmp/patchverdict";

export async function runTestTool(
  sandbox: Sandbox,
  input: unknown,
): Promise<ToolResult<RunTestOutput>> {
  try {
    const parsed = RunTestInputSchema.parse(input);

    const safeName = parsed.testName.replace(/["\\$`]/g, "");

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
