import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";

import { runSandboxCommand } from "../sandbox/e2b.js";

const PROJECT_ROOT = "/tmp/patchverdict";

export type GitEvidence = {
  baseCommit: string;
  diff: string;
  changed: boolean;
  changedFiles: string[];
};

export async function getGitEvidence(
  sandbox: Sandbox,
): Promise<ToolResult<GitEvidence>> {
  try {
    const baseCommitResult = await runSandboxCommand(
      sandbox,
      "git rev-parse HEAD",
      PROJECT_ROOT,
    );

    if (baseCommitResult.exitCode !== 0) {
      return {
        ok: false,
        error: baseCommitResult.stderr || "Could not determine base commit",
      };
    }

    const diffResult = await runSandboxCommand(
      sandbox,
      "git diff --no-ext-diff --no-color",
      PROJECT_ROOT,
    );

    if (diffResult.exitCode !== 0) {
      return {
        ok: false,
        error: diffResult.stderr || "Could not generate Git diff",
      };
    }

    const changedFilesResult = await runSandboxCommand(
      sandbox,
      "git diff --name-only",
      PROJECT_ROOT,
    );

    if (changedFilesResult.exitCode !== 0) {
      return {
        ok: false,
        error: changedFilesResult.stderr || "Could not determine changed files",
      };
    }

    const diff = diffResult.stdout.trim();

    const changedFiles = changedFilesResult.stdout
      .split("\n")
      .map((file) => file.trim())
      .filter(Boolean);

    return {
      ok: true,
      data: {
        baseCommit: baseCommitResult.stdout.trim(),

        diff,

        changed: diff.length > 0,

        changedFiles,
      },
    };
  } catch (error) {
    return {
      ok: false,

      error:
        error instanceof Error ? error.message : "Unknown Git evidence error",
    };
  }
}
