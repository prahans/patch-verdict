import type { Sandbox } from "e2b";

import { listFilesTool } from "./list-files.js";

import { readFileTool } from "./read-file.js";

import { runTestTool } from "./run-test.js";

import { searchCodeTool } from "./search-code.js";

export type ToolName = "list_files" | "read_file" | "search_code" | "run_test";

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
  }
}
