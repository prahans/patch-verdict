import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";

import { runSandboxCommand } from "../sandbox/e2b.js";

const PROJECT_ROOT = "/tmp/patchverdict";

export type GitDiffOutput = {
  diff: string;
  changed: boolean;
};

export async function getGitDiff(
  sandbox: Sandbox,
): Promise<ToolResult<GitDiffOutput>> {
  try {
    const result = await runSandboxCommand(
      sandbox,
      "git diff --no-ext-diff",
      PROJECT_ROOT,
    );

    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: result.stderr || "Could not generate Git diff",
      };
    }

    const diff = result.stdout.trim();

    return {
      ok: true,
      data: {
        diff,
        changed: diff.length > 0,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown git diff error",
    };
  }
}
