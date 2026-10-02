import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";

import { runSandboxCommand } from "../sandbox/e2b.js";

const PROJECT_ROOT = "/tmp/patchverdict";

type RunFullSuiteOutput = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export async function runFullSuiteTool(
  sandbox: Sandbox,
): Promise<ToolResult<RunFullSuiteOutput>> {
  try {
    const evidence = await runSandboxCommand(sandbox, "npm test", PROJECT_ROOT);

    return {
      ok: true,
      data: evidence,
    };
  } catch (error) {
    return {
      ok: false,

      error:
        error instanceof Error ? error.message : "Unknown full-suite error",
    };
  }
}
