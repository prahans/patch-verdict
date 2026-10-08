import path from "node:path";
import { z } from "zod";
import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";
import { readSandboxFile, writeSandboxFile } from "../sandbox/e2b.js";

const PROJECT_ROOT = "/tmp/patchverdict";

const ApplyPatchInputSchema = z.object({
  path: z.string().min(1).max(500),

  oldText: z.string().min(1).max(50_000),

  newText: z.string().max(50_000),
});

type ApplyPatchOutput = {
  path: string;
  changed: boolean;
  before: string;
  after: string;
};

function resolveSafePath(relativePath: string) {
  const normalized = path.posix.normalize(relativePath);

  if (
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("Path must stay inside the repository");
  }

  return path.posix.join(PROJECT_ROOT, normalized);
}

export async function applyPatchTool(
  sandbox: Sandbox,
  input: unknown,
): Promise<ToolResult<ApplyPatchOutput>> {
  try {
    const parsed = ApplyPatchInputSchema.parse(input);

    const safePath = resolveSafePath(parsed.path);

    const before = await readSandboxFile(sandbox, safePath);

    const lineEnding = before.includes("\r\n") ? "\r\n" : "\n";

    const oldText = parsed.oldText.replace(/\r?\n/g, lineEnding);
    const newText = parsed.newText.replace(/\r?\n/g, lineEnding);

    const occurrences = before.split(oldText).length - 1;

    if (occurrences === 0) {
      return {
        ok: false,
        error:
          "oldText was not found exactly in the target file. Read the file again and copy the smallest exact existing code region.",
      };
    }

    if (occurrences > 1) {
      return {
        ok: false,
        error: `Expected oldText to match exactly once, but found ${occurrences} matches. Use a slightly larger unique code region.`,
      };
    }

    if (oldText === newText) {
      return {
        ok: true,
        data: {
          path: parsed.path,
          changed: false,
          before,
          after: before,
        },
      };
    }

    const updatedContent = before.replace(oldText, newText);

    await writeSandboxFile(sandbox, safePath, updatedContent);

    const after = await readSandboxFile(sandbox, safePath);

    return {
      ok: true,
      data: {
        path: parsed.path,
        changed: before !== after,
        before,
        after,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unknown apply_patch error",
    };
  }
}
