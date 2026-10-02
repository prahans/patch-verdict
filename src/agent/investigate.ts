import type { Sandbox } from "e2b";
import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";

import { executeTool, type ToolName } from "../tools/index.js";

import { investigationToolDefinitions } from "./tool-definitions.js";

import { INVESTIGATION_SYSTEM_PROMPT } from "./prompt.js";

const MAX_ITERATIONS = 8;
const MAX_DUPLICATE_CALLS = 2;

export async function investigateIssue(sandbox: Sandbox, issue: string) {
  const messages: ChatMessages[] = [
    {
      role: "system",
      content: INVESTIGATION_SYSTEM_PROMPT,
    },

    {
      role: "user",
      content: `
Investigate this reported issue:

${issue}
`.trim(),
    },
  ];

  const toolCallCache = new Map<string, unknown>();

  let duplicateCalls = 0;

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    console.log("");
    console.log(`AGENT ITERATION ${iteration}`);

    const response = await openRouter.chat.send({
      chatRequest: {
        model: AGENT_MODEL,
        messages,
        tools: investigationToolDefinitions,
        stream: false,
      },
    });

    if (!("choices" in response)) {
      throw new Error("Expected a non-streaming chat completion");
    }

    const message = response.choices[0]?.message;

    if (!message) {
      throw new Error("Model returned no message");
    }

    messages.push(message);

    const toolCalls = message.toolCalls;

    /*
     * No tool call means the model believes
     * its investigation is finished.
     */
    if (!toolCalls || toolCalls.length === 0) {
      return {
        completed: true,
        iterations: iteration,
        report:
          typeof message.content === "string"
            ? message.content
            : (message.content ?? [])
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("\n"),
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

      const toolKey = `${toolName}:${JSON.stringify(input)}`;
      const cachedResult = toolCallCache.get(toolKey);

      if (cachedResult !== undefined) {
        duplicateCalls++;

        console.log(`↻ ${toolName} DUPLICATE — using cached result`);

        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: JSON.stringify({
            result: cachedResult,

            meta: {
              cached: true,
              message:
                "This identical tool call was already executed. Repository state has not changed. Use the existing evidence and do not repeat this call.",
            },
          }),
        });

        if (duplicateCalls >= MAX_DUPLICATE_CALLS) {
          messages.push({
            role: "user",
            content:
              "You are repeating tool calls without gathering new evidence. Stop using tools and provide your investigation report now.",
          });
        }

        continue;
      }

      console.log(`→ ${toolName}`, input);

      let result;

      try {
        result = await executeTool(sandbox, toolName, input);
      } catch (error) {
        result = {
          ok: false,

          error:
            error instanceof Error ? error.message : "Tool execution failed",
        };
      }

      console.log(`← ${toolName}`, result.ok ? "OK" : "ERROR");

      messages.push({
        role: "tool",

        toolCallId: toolCall.id,

        content: JSON.stringify(result),
      });
    }
  }

  return {
    completed: false,
    iterations: MAX_ITERATIONS,

    report: "Investigation stopped because the iteration budget was exhausted.",
  };
}
