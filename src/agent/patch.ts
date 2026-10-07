import type { Sandbox } from "e2b";
import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";

import { executeTool, type ToolName } from "../tools/index.js";

import { patchToolDefinitions } from "./tool-definitions.js";

import { PATCH_SYSTEM_PROMPT } from "./patch-prompt.js";
import {
  buildPatchAgentContext,
  type PatchInvestigationContext,
} from "./patch-context.js";

import { messageContentToText } from "./message-content.js";
import {
  authorizePatchToolInput,
  type PatchAuthorizationEvidence,
} from "./patch-authorization.js";

const MAX_PATCH_ITERATIONS = 4;
const PATCH_ALLOWED_TOOLS = new Set<string>([
  "list_files",
  "read_file",
  "apply_patch",
]);

export async function patchIssue(
  sandbox: Sandbox,
  issue: string,
  investigation: PatchInvestigationContext,
) {
  const patchContext = buildPatchAgentContext(investigation);
  const messages: ChatMessages[] = [
    {
      role: "system",
      content: PATCH_SYSTEM_PROMPT,
    },

    {
      role: "user",

      content: `
Reported issue:

${issue}

Validated investigation context:

${JSON.stringify(patchContext, null, 2)}

Apply the smallest reasonable candidate patch that addresses the diagnosed root cause.
`.trim(),
    },
  ];

  let patchApplied = false;
  let authorizationEvidence: PatchAuthorizationEvidence | undefined;

  for (let iteration = 1; iteration <= MAX_PATCH_ITERATIONS; iteration++) {
    console.log("");
    console.log(`PATCH ITERATION ${iteration}`);

    const response = await openRouter.chat.send({
      chatRequest: {
        model: AGENT_MODEL,
        messages,
        tools: patchToolDefinitions,
        stream: false,
      },
    });

    if (!("choices" in response)) {
      throw new Error("Expected non-streaming response");
    }

    const message = response.choices[0]?.message;

    if (!message) {
      throw new Error("Model returned no message");
    }

    messages.push(message);

    const toolCalls = message.toolCalls;

    if (!toolCalls || toolCalls.length === 0) {
      return {
        completed: true,
        patchApplied,
        authorization: authorizationEvidence,
        report: messageContentToText(message.content),
      };
    }

    for (const toolCall of toolCalls) {
      const requestedToolName = toolCall.function.name;

      // Never trust a model-provided tool name.
      if (!PATCH_ALLOWED_TOOLS.has(requestedToolName)) {
        const blockedResult = {
          ok: false as const,
          error: `Tool "${requestedToolName}" is not permitted during the PATCH phase.`,
        };

        console.log(`→ ${requestedToolName}`);

        console.log(`← ${requestedToolName} BLOCKED`);

        messages.push({
          role: "tool",

          toolCallId: toolCall.id,

          content: JSON.stringify(blockedResult),
        });

        continue;
      }

      const toolName = requestedToolName as ToolName;

      let input: unknown;

      try {
        input = JSON.parse(toolCall.function.arguments);
      } catch {
        input = {};
      }

      console.log(`→ ${toolName}`);

      let executionInput = input;

      if (toolName === "apply_patch") {
        const authorization = authorizePatchToolInput(
          input,
          investigation.diagnosis.patchIntents,
        );

        if (!authorization.ok) {
          const blockedResult = {
            ok: false as const,
            error: authorization.error,
          };

          console.log(`← ${toolName} BLOCKED: ${authorization.error}`);

          messages.push({
            role: "tool",

            toolCallId: toolCall.id,

            content: JSON.stringify(blockedResult),
          });

          continue;
        }

        authorizationEvidence = authorization.authorization;

        console.log(
          `  intent: ${authorization.authorization.intentId} -> ${authorization.authorization.authorizedPath}`,
        );

        executionInput = authorization.input;
      }

      let result;

      try {
        result = await executeTool(sandbox, toolName, executionInput);
      } catch (error) {
        result = {
          ok: false as const,

          error:
            error instanceof Error ? error.message : "Tool execution failed",
        };
      }

      if (result.ok) {
        console.log(`← ${toolName} OK`);
      } else {
        console.log(`← ${toolName} ERROR: ${result.error}`);
      }

      if (
        toolName === "apply_patch" &&
        result.ok &&
        "data" in result &&
        "changed" in result.data &&
        result.data.changed
      ) {
        patchApplied = true;
      }

      messages.push({
        role: "tool",

        toolCallId: toolCall.id,

        content: JSON.stringify(result),
      });
    }

    /*
     * Once a real patch was applied,
     * stop granting further autonomous edits.
     */
    if (patchApplied) {
      return {
        completed: true,
        patchApplied: true,
        authorization: authorizationEvidence,
        report: "Candidate patch applied.",
      };
    }
  }

  return {
    completed: false,
    patchApplied,
    authorization: authorizationEvidence,
    report: "Patch iteration budget exhausted.",
  };
}
