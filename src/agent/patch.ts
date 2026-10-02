import type { Sandbox } from "e2b";
import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";

import { executeTool, type ToolName } from "../tools/index.js";

import { patchToolDefinitions } from "./tool-definitions.js";

import { PATCH_SYSTEM_PROMPT } from "./patch-prompt.js";

const MAX_PATCH_ITERATIONS = 4;

export async function patchIssue(
  sandbox: Sandbox,
  issue: string,
  investigationReport: string,
) {
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

Investigation report:

${investigationReport}

Apply the smallest reasonable candidate patch.
`.trim(),
    },
  ];

  let patchApplied = false;

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
        report: message.content ?? "",
      };
    }

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name as ToolName;

      let input: unknown;

      try {
        input = JSON.parse(toolCall.function.arguments);
      } catch {
        input = {};
      }

      console.log(`→ ${toolName}`);

      const result = await executeTool(sandbox, toolName, input);

      console.log(`← ${toolName}`, result.ok ? "OK" : "ERROR");

      if (
        toolName === "apply_patch" &&
        result.ok &&
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
        report: "Candidate patch applied.",
      };
    }
  }

  return {
    completed: false,
    patchApplied,
    report: "Patch iteration budget exhausted.",
  };
}
