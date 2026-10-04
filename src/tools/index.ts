import type { Sandbox } from "e2b";

import { listFilesTool } from "./list-files.js";

import { readFileTool } from "./read-file.js";

import { runTestTool } from "./run-test.js";

import { searchCodeTool } from "./search-code.js";

import { applyPatchTool } from "./apply-patch.js";

export type ToolName =
  | "list_files"
  | "read_file"
  | "search_code"
  | "run_test"
  | "apply_patch";

export async function executeTool(
  sandbox: Sandbox,
  toolName: ToolName,
  input: unknown,
) {
  switch (toolName) {
    case "list_files":
      return listFilesTool(sandbox, input);

    case "read_file":
      return readFileTool(sandbox, input);

    case "search_code":
      return searchCodeTool(sandbox, input);

    case "run_test":
      return runTestTool(sandbox, input);

    case "apply_patch":
      return applyPatchTool(sandbox, input);

    default:
      return {
        ok: false as const,
        error: `Unknown tool: ${toolName}`,
      };
  }
}
