import { z } from "zod";
import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";
import { runSandboxCommand } from "../sandbox/e2b.js";

const ListFilesInputSchema = z.object({
  depth: z.number().int().min(1).max(5).default(3),
});

type ListFilesOutput = {
  files: string[];
};

const PROJECT_ROOT = "/tmp/patchverdict";

export async function listFilesTool(
  sandbox: Sandbox,
  input: unknown,
): Promise<ToolResult<ListFilesOutput>> {
  try {
    const parsed = ListFilesInputSchema.parse(input);

    const result = await runSandboxCommand(
      sandbox,
      `find . -maxdepth ${parsed.depth} -type f -not -path "./node_modules/*" | sort`,
      PROJECT_ROOT,
    );

    if (result.exitCode !== 0) {
      return {
        ok: false,
        error: result.stderr || "Failed to list files",
      };
    }

    const files = result.stdout
      .split("\n")
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter(Boolean);

    return {
      ok: true,
      data: {
        files,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unknown list_files error",
    };
  }
}
