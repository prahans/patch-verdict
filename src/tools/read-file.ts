import path from "node:path";
import { z } from "zod";
import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";
import { readSandboxFile } from "../sandbox/e2b.js";

const ReadFileInputSchema = z.object({
  path: z.string().min(1).max(500),
});

type ReadFileOutput = {
  path: string;
  content: string;
};

const PROJECT_ROOT = "/tmp/patchverdict";

function resolveSafePath(relativePath: string) {
  const normalized = path.posix.normalize(relativePath);

  if (
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("Path must stay inside the project");
  }

  return path.posix.join(PROJECT_ROOT, normalized);
}

export async function readFileTool(
  sandbox: Sandbox,
  input: unknown,
): Promise<ToolResult<ReadFileOutput>> {
  try {
    const parsed = ReadFileInputSchema.parse(input);

    const safePath = resolveSafePath(parsed.path);

    const content = await readSandboxFile(sandbox, safePath);

    return {
      ok: true,
      data: {
        path: parsed.path,
        content,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown read_file error",
    };
  }
}
