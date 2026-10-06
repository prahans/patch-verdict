import type { Sandbox } from "e2b";
import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";

import { executeTool, type ToolName } from "../tools/index.js";

import { investigationToolDefinitions } from "./tool-definitions.js";

import { INVESTIGATION_SYSTEM_PROMPT } from "./prompt.js";

import {
  parseInvestigationModelOutput,
  type InvestigationModelOutput,
} from "./investigation-contract.js";

import { messageContentToText } from "./message-content.js";
import { assertInvestigationProvenance } from "./investigation-provenance.js";
import type { InvestigationBaselineContext } from "./investigation-context.js";
import { assertPatchTargetAnalysis } from "./investigation-targeting.js";
import { assertPatchIntentContract } from "./investigation-intents.js";

const MAX_ITERATIONS = 8;
const MAX_DUPLICATE_CALLS = 2;
const MAX_TEST_CALLS = 2;

function createToolCallKey(toolName: string, input: unknown) {
  return `${toolName}:${JSON.stringify(input)}`;
}

function getInputString(input: unknown, key: string) {
  if (typeof input !== "object" || input === null) {
    return undefined;
  }

  const value = (input as Record<string, unknown>)[key];

  return typeof value === "string" ? value.trim() : undefined;
}

async function parseFinalInvestigation(
  messages: ChatMessages[],
  content: unknown,
): Promise<InvestigationModelOutput> {
  const text = messageContentToText(content);

  try {
    return parseInvestigationModelOutput(text);
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "Unknown structured-output error";

    /*
     * Give the model exactly one opportunity
     * to repair malformed structured output.
     *
     * No tools are exposed during this repair.
     */
    messages.push({
      role: "user",

      content: `
Your final investigation response did not satisfy PatchVerdict's structured investigation contract.

Validation error:

${reason}

Return the final investigation again as ONLY valid JSON.

Use exactly this shape:

{
  "report": "Human-readable investigation summary.",
  "diagnosis": {
    "rootCause": "Evidence-supported root cause hypothesis.",
    "evidence": [
      {
        "kind": "FILE",
        "source": "src/example.ts",
        "observation": "Concrete observed evidence."
      }
    ],
    "relevantFiles": [
      "src/example.ts"
    ],
    "recommendedPatchTargets": [
      "src/example.ts"
    ],
    "patchTargetAnalysis": [
      {
        "path": "src/example.ts",
        "decision": "RECOMMEND",
        "reason": "This location directly addresses the diagnosed root cause."
      }
    ],
    "patchIntents": [
      {
        "id": "intent-1",
        "path": "src/example.ts",
        "objective": "Correct the behavior identified by the investigation.",
        "evidenceRefs": [
          {
            "kind": "FILE",
            "source": "src/example.ts"
          }
        ]
      }
    ],
    "confidence": "LOW"
  }
}

Allowed evidence kinds:
FILE, TEST, SEARCH

Allowed confidence values:
LOW, MEDIUM, HIGH

Allowed patch-target decisions:
RECOMMEND, REJECT

Patch-intent rules:

- intent ids must use intent-1, intent-2, and so on
- every patch intent path must be a recommendedPatchTargets path
- every patch intent path must be marked RECOMMEND in patchTargetAnalysis
- every evidenceRefs entry must exactly match evidence already present in diagnosis.evidence
- do not introduce a repair objective that is unrelated to the diagnosed root cause

Do not use Markdown fences.
Do not call tools.
Do not include additional fields.
`.trim(),
    });

    const repairResponse = await openRouter.chat.send({
      chatRequest: {
        model: AGENT_MODEL,
        messages,
        stream: false,
      },
    });

    if (!("choices" in repairResponse)) {
      throw new Error(
        "Expected a non-streaming structured investigation repair response",
      );
    }

    const repairMessage = repairResponse.choices[0]?.message;

    if (!repairMessage) {
      throw new Error(
        "Model returned no structured investigation repair response",
      );
    }

    messages.push(repairMessage);

    const repairedText = messageContentToText(repairMessage.content);

    /*
     * No second repair attempt.
     * If this fails, the investigation fails
     * rather than silently accepting malformed data.
     */
    return parseInvestigationModelOutput(repairedText);
  }
}

export async function investigateIssue(
  sandbox: Sandbox,
  issue: string,
  baseline: InvestigationBaselineContext,
) {
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

PatchVerdict has already reproduced the reported failure using its trusted verification runner.

Authoritative baseline evidence:

${JSON.stringify(baseline, null, 2)}

Important:

- The baseline reproduction above is trusted PatchVerdict evidence.
- You do not need to rerun the same failure merely to prove it exists.
- Use run_test only when a more targeted execution would materially help distinguish competing root-cause hypotheses.
- Focus your tool budget on locating and understanding the root cause.
`.trim(),
    },
  ];

  const toolCallCache = new Map<string, unknown>();

  let duplicateCalls = 0;
  let testCalls = 0;
  let forceFinalReport = false;
  let completedIterations = 0;
  const inspectedFiles = new Set<string>();

  const executedTests = new Set<string>();

  const executedTestCommands = new Set<string>();

  const searchQueries = new Set<string>();

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
    completedIterations = iteration;
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
      /*
       * A model cannot finish an investigation
       * without inspecting repository evidence.
       */
      if (inspectedFiles.size === 0) {
        console.log(
          "⊘ FINAL REPORT REJECTED — no repository files were inspected",
        );

        messages.push({
          role: "user",

          content: `
You cannot finalize the investigation yet.

PatchVerdict has no successful read_file evidence from this investigation.

Use repository tools to inspect the relevant implementation or test files before producing the final structured diagnosis.

Do not guess file paths.
Use list_files or search_code when necessary, then read_file the files that support your diagnosis.
`.trim(),
        });

        continue;
      }

      const structured = await parseFinalInvestigation(
        messages,
        message.content,
      );

      try {
        assertInvestigationProvenance(structured.diagnosis, {
          inspectedFiles: [...inspectedFiles],

          executedTests: [...executedTests],

          executedTestCommands: [...executedTestCommands],

          searchQueries: [...searchQueries],
          trustedTestCommands: [baseline.command],
        });
        assertPatchTargetAnalysis(structured.diagnosis, {
          inspectedFiles: [...inspectedFiles],
        });
        assertPatchIntentContract(structured.diagnosis);
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : "Unknown provenance validation error";

        console.log(
          [
            "⊘ FINAL REPORT REJECTED — diagnosis is not grounded in observed evidence",
            "",
            reason,
            "",
            "REJECTED DIAGNOSIS:",
            JSON.stringify(structured.diagnosis, null, 2),
          ].join("\n"),
        );

        messages.push({
          role: "user",

          content: `
PatchVerdict rejected your structured diagnosis because some claims are not grounded in tool evidence.

${reason}

Use tools to inspect any missing files or revise the diagnosis so that:

- every relevantFiles path was successfully read
- every recommendedPatchTargets path was successfully read
- every recommended patch target is also listed in relevantFiles
- if you recommend a direct test file after inspecting test infrastructure,
  every inspected test-infrastructure candidate must be included in relevantFiles
  and explicitly accounted for in patchTargetAnalysis as RECOMMEND or REJECT
- FILE evidence refers to a successfully read file
- TEST evidence must refer to either:
  - the exact test selector passed to a successful run_test call
  - the exact command returned by a successful run_test call
  - the authoritative baseline command supplied by PatchVerdict
- SEARCH evidence refers to a search query actually executed during this investigation
- every recommended patch target has at least one patchIntents entry
- every patch intent targets a RECOMMEND path
- every patch intent evidenceRefs entry exactly matches existing diagnosis evidence

Do not invent paths, evidence, or unrelated patch objectives.
`.trim(),
        });

        continue;
      }

      return {
        completed: true,
        iterations: iteration,
        report: structured.report,
        diagnosis: structured.diagnosis,
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

      const toolKey = createToolCallKey(toolName, input);

      const cachedResult = toolCallCache.get(toolKey);

      /*
       * Identical calls reuse previous evidence.
       * Never execute the same command twice.
       */

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
                "This identical tool call was already executed. Use the existing evidence and do not repeat this call.",
            },
          }),
        });

        if (duplicateCalls >= MAX_DUPLICATE_CALLS) {
          messages.push({
            role: "user",

            content:
              "You are repeating tool calls without gathering new evidence. Stop using tools and provide your investigation report now.",
          });

          forceFinalReport = true;
        }

        continue;
      }

      if (toolName === "run_test") {
        const testName =
          typeof input === "object" &&
          input !== null &&
          "testName" in input &&
          typeof input.testName === "string"
            ? input.testName.trim()
            : "";

        if (!testName) {
          const invalidResult = {
            ok: false as const,

            error: "run_test requires a non-empty testName.",
          };

          /*
           * Cache the rejection too, so the same
           * malformed request is not handled repeatedly.
           */
          toolCallCache.set(toolKey, invalidResult);

          console.log("⊘ run_test REJECTED — testName must be non-empty");

          messages.push({
            role: "tool",

            toolCallId: toolCall.id,

            content: JSON.stringify(invalidResult),
          });

          continue;
        }
      }

      /*
       * Only NEW run_test executions count
       * against the execution budget.
       */
      if (toolName === "run_test" && testCalls >= MAX_TEST_CALLS) {
        console.log("⊘ run_test BLOCKED — investigation test budget exhausted");

        messages.push({
          role: "tool",

          toolCallId: toolCall.id,

          content: JSON.stringify({
            ok: false,

            error:
              "Investigation test budget exhausted. Use the evidence already collected and provide the investigation report.",
          }),
        });

        messages.push({
          role: "user",

          content:
            "You have enough execution evidence. Stop calling tools and provide your final investigation report now.",
        });

        forceFinalReport = true;

        continue;
      }

      console.log(`→ ${toolName}`, input);

      let result;

      try {
        result = await executeTool(sandbox, toolName, input);
      } catch (error) {
        result = {
          ok: false as const,

          error:
            error instanceof Error ? error.message : "Tool execution failed",
        };
      }

      console.log(`← ${toolName}`, result.ok ? "OK" : "ERROR");

      /*
       * Cache the actual evidence so an
       * identical call is never executed again.
       */
      toolCallCache.set(toolKey, result);

      if (result.ok) {
        if (toolName === "read_file") {
          const filePath = getInputString(input, "path");

          if (filePath) {
            inspectedFiles.add(
              filePath.replace(/\\/g, "/").replace(/^\.\//, ""),
            );
          }
        }

        if (toolName === "run_test") {
          const testName = getInputString(input, "testName");

          if (testName) {
            executedTests.add(testName);
          }

          if (
            "data" in result &&
            typeof result.data === "object" &&
            result.data !== null &&
            "command" in result.data &&
            typeof result.data.command === "string"
          ) {
            executedTestCommands.add(result.data.command.trim());
          }
        }

        if (toolName === "search_code") {
          const query = getInputString(input, "query");

          if (query) {
            searchQueries.add(query);
          }
        }
      }

      if (toolName === "run_test" && result.ok) {
        testCalls++;
      }

      messages.push({
        role: "tool",

        toolCallId: toolCall.id,

        content: JSON.stringify(result),
      });
    }
    if (forceFinalReport) {
      break;
    }
  }

  console.log("");
  console.log(
    "Investigation budget exhausted — requesting final report without tools",
  );

  messages.push({
    role: "user",
    content:
      "The investigation tool budget is exhausted. You may not call any more tools. Based only on the evidence already collected, provide your final investigation report now.",
  });

  const finalResponse = await openRouter.chat.send({
    chatRequest: {
      model: AGENT_MODEL,
      messages,
      stream: false,
    },
  });

  if (!("choices" in finalResponse)) {
    throw new Error("Expected a non-streaming final investigation response");
  }

  const finalMessage = finalResponse.choices[0]?.message;

  if (!finalMessage) {
    throw new Error("Model returned no final investigation report");
  }

  messages.push(finalMessage);

  const structured = await parseFinalInvestigation(
    messages,
    finalMessage.content,
  );

  assertInvestigationProvenance(structured.diagnosis, {
    inspectedFiles: [...inspectedFiles],

    executedTests: [...executedTests],

    executedTestCommands: [...executedTestCommands],

    searchQueries: [...searchQueries],
    trustedTestCommands: [baseline.command],
  });
  assertPatchTargetAnalysis(structured.diagnosis, {
    inspectedFiles: [...inspectedFiles],
  });
  assertPatchIntentContract(structured.diagnosis);

  return {
    completed: true,

    iterations: completedIterations,

    report: structured.report,

    diagnosis: structured.diagnosis,
  };
}
