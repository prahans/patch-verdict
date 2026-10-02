import { z } from "zod";
import type { Sandbox } from "e2b";

import type { ToolResult } from "../agent/types.js";
import { runSandboxCommand } from "../sandbox/e2b.js";

const SearchCodeInputSchema = z.object({
  query: z.string().min(1).max(100),
});

type SearchMatch = {
  line: string;
};

type SearchCodeOutput = {
  query: string;
  matches: SearchMatch[];
};

const PROJECT_ROOT = "/tmp/patchverdict";

function escapeShellSingleQuotes(value: string) {
  return value.replace(/'/g, `'\\''`);
}

export async function searchCodeTool(
  sandbox: Sandbox,
  input: unknown,
): Promise<ToolResult<SearchCodeOutput>> {
  try {
    const parsed = SearchCodeInputSchema.parse(input);

    const escaped = escapeShellSingleQuotes(parsed.query);

    const result = await runSandboxCommand(
      sandbox,
      `grep -R -n -F '${escaped}' . \
--exclude-dir=node_modules \
--exclude-dir=.git \
--exclude=package-lock.json \
--exclude=pnpm-lock.yaml \
--exclude=yarn.lock \
| head -50`,
      PROJECT_ROOT,
    );

    /*
     * grep exit code 1 simply means:
     * no matches.
     */
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return {
        ok: false,
        error: result.stderr || "Code search failed",
      };
    }

    const matches = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => ({
        line,
      }));

    return {
      ok: true,
      data: {
        query: parsed.query,
        matches,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Unknown search_code error",
    };
  }
}
