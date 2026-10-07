import type { Sandbox } from "e2b";
import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";
import { CommandEvidenceSchema } from "../evidence/command-evidence.js";
import { executeTool, type ToolName } from "../tools/index.js";
import { investigationToolDefinitions } from "./tool-definitions.js";
import { CAUSAL_INVESTIGATION_SYSTEM_PROMPT } from "./causal-investigation-prompt.js";
import type { InvestigationBaselineContext } from "./investigation-context.js";
import { validateDiscoveredReadPath } from "./investigation-paths.js";
import { findUninspectedCausalContext } from "./investigation-causal-context.js";
import { reconnaissanceForModel, type ReconnaissanceContext } from "./reconnaissance.js";
import { createInitialHypothesisBoard } from "./create-hypothesis-board.js";
import { createCausalFreeze, type CreateCausalFreezeInput } from "./create-causal-freeze.js";
import { runCounterfactualExperiment, type CounterfactualExperimentEvidence } from "../tools/run-counterfactual.js";

const MAX_ITERATIONS = 8;
const MAX_DUPLICATE_CALLS = 2;
const MAX_TEST_CALLS = 2;
const MAX_COUNTERFACTUAL_EXPERIMENTS = 2;
const ALLOWED_TOOLS = new Set(investigationToolDefinitions.map((tool) => tool.function.name));

function createToolCallKey(toolName: string, input: unknown) {
  return `${toolName}:${JSON.stringify(input)}`;
}

function getInputString(input: unknown, key: string) {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : undefined;
}

export async function investigateIssue(
  sandbox: Sandbox,
  issue: string,
  baseline: InvestigationBaselineContext,
  reconnaissance: ReconnaissanceContext,
  projectRoot: string,
) {
  console.log("");
  console.log("HYPOTHESIS BOARD");
  console.log("Generating initial causal hypotheses before patch planning...");

  const hypothesisBoard = await createInitialHypothesisBoard({
    issue,
    baseline,
    reconnaissance,
  });

  for (const hypothesis of hypothesisBoard.hypotheses) {
    console.log(
      `  ${hypothesis.id} [${hypothesis.layer}] ${hypothesis.hypothesis}`,
    );
  }

  console.log(
    `  Next discrimination goal: ${hypothesisBoard.discriminationGoal.question}`,
  );

  const messages: ChatMessages[] = [
    {
      role: "system",
      content: CAUSAL_INVESTIGATION_SYSTEM_PROMPT,
    },

    {
      role: "user",
      content: `
Investigate this reported issue:

${issue}

PatchVerdict has already reproduced the reported failure using its trusted verification runner.

Authoritative baseline evidence:

${JSON.stringify(baseline, null, 2)}

Deterministic reconnaissance already completed before this reasoning phase:

${JSON.stringify(reconnaissanceForModel(reconnaissance), null, 2)}

Initial target-free Hypothesis Board:

${JSON.stringify(hypothesisBoard, null, 2)}

Important:

- The baseline reproduction above is trusted PatchVerdict evidence.
- Files listed in reconnaissance.preInspectedFiles were successfully read by PatchVerdict before the AI reasoning loop. Their supplied contents are trusted repository evidence.
- The reconnaissance inventory is deterministic repository discovery, not a model guess.
- Do not spend tool calls rereading pre-inspected files unless the supplied content is truncated and the missing portion is materially necessary.
- Do not call list_files merely to rediscover the inventory already supplied. Use it only when you need deeper repository discovery.
- You do not need to rerun the same failure merely to prove it exists.
- Use run_test only when a more targeted execution would materially help distinguish competing root-cause hypotheses.
- Use run_counterfactual when changing one allowlisted runner-config or shared test-setup variable can distinguish two or more hypotheses. PatchVerdict will run only the trusted reproduction command and restore the file exactly.
- A counterfactual intervention is experiment evidence, never a candidate patch.
- A TEST_SETUP_CONTROL that removes the failure proves that the control can suppress the symptom; it does not by itself prove that test setup owns the underlying cause.
- Prefer RUNNER_CONFIGURATION experiments when they directly manipulate a hypothesized upstream execution variable.
- Focus your tool budget on distinguishing causes, not rebuilding deterministic repository context.
- Treat the Hypothesis Board as the causal starting state. Gather evidence that supports, contradicts, or distinguishes those hypotheses.
- Do not collapse directly from "this file can be edited" to "this file owns the cause."
- Patch targeting belongs after causal reasoning; the initial Hypothesis Board intentionally contains no patch target.
`.trim(),
    },
  ];

  const toolCallCache = new Map<string, unknown>();
  const preloadedToolCalls = new Set<string>();

  for (const file of reconnaissance.files) {
    if (file.truncated) {
      continue;
    }

    const key = createToolCallKey("read_file", {
      path: file.path,
    });

    preloadedToolCalls.add(key);

    toolCallCache.set(key, {
      ok: true as const,
      data: {
        path: file.path,
        content: file.content,
      },
    });
  }

  let duplicateCalls = 0;
  let testCalls = 0;
  let counterfactualCalls = 0;
  let forceCausalFinalization = false;
  let completedIterations = 0;
  const inspectedFiles = new Set<string>(
    reconnaissance.preInspectedFiles,
  );

  const observedFiles = new Map(
    reconnaissance.files.map((file) => [file.path, {
      path: file.path,
      content: file.content,
      truncated: file.truncated,
    }]),
  );
  const observedTests: CreateCausalFreezeInput["tests"][number][] = [];

  const executedExperiments = new Set<string>();

  const counterfactualEvidence: CounterfactualExperimentEvidence[] = [];

  const discoveredFiles = new Set<string>(
    reconnaissance.inventory,
  );

  let discoveredDepth = reconnaissance.inventoryDepth;

  let causalContextHintSent = false;

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

    // The model may end collection, but its free-text conclusion is never
    // accepted as a diagnosis or passed to the causal assessor/planner.
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    let shouldSendCausalContextHint = false;

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name as
        | ToolName
        | "run_counterfactual";

      let input: unknown;

      try {
        input = JSON.parse(toolCall.function.arguments);
      } catch {
        input = {};
      }

      // Tool availability is a host boundary, not merely a prompt promise.
      if (!ALLOWED_TOOLS.has(toolName)) {
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: JSON.stringify({ ok: false, error: "Tool is not allowed during causal investigation." }),
        });
        continue;
      }

      const toolKey = createToolCallKey(toolName, input);

      const cachedResult = toolCallCache.get(toolKey);

      /*
       * Identical calls reuse previous evidence.
       * Never execute the same command twice.
       */

      if (cachedResult !== undefined) {
        const preloaded = preloadedToolCalls.has(toolKey);

        if (!preloaded) {
          duplicateCalls++;
        }

        console.log(
          preloaded
            ? `↻ ${toolName} PRELOADED — using deterministic reconnaissance`
            : `↻ ${toolName} DUPLICATE — using cached result`,
        );

        const uninspectedCausalContext =
          findUninspectedCausalContext(
            [...discoveredFiles],
            [...inspectedFiles],
          );

        messages.push({
          role: "tool",

          toolCallId: toolCall.id,

          content: JSON.stringify({
            result: cachedResult,

            meta: {
              cached: true,
              preloadedByReconnaissance: preloaded,

              message: preloaded
                ? "PatchVerdict already read this file during deterministic reconnaissance. Use the supplied evidence without spending another repository read."
                : "This identical tool call was already executed. Use the existing evidence and do not repeat this call.",

              ...(uninspectedCausalContext.length > 0 && {
                uninspectedCausalContext,

                guidance:
                  "Before making a HIGH-confidence causal claim about test infrastructure, configuration, or dependency/runtime behavior, inspect the discovered package/test-runner context listed here if it can distinguish competing causes.",
              }),
            },
          }),
        });

        if (!preloaded && duplicateCalls >= MAX_DUPLICATE_CALLS) {
          messages.push({
            role: "user",

            content:
              "You are repeating tool calls without gathering new evidence. Stop using tools and provide your end causal evidence collection now.",
          });

          forceCausalFinalization = true;
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

      if (toolName === "read_file") {
        const requestedPath = getInputString(input, "path");

        if (requestedPath) {
          const validation = validateDiscoveredReadPath(
            requestedPath,
            [...discoveredFiles],
            discoveredDepth,
          );

          if (!validation.ok) {
            const rejectedResult = {
              ok: false as const,
              error: validation.error,
              ...(validation.suggestions.length > 0 && {
                suggestions: validation.suggestions,
              }),
            };

            toolCallCache.set(toolKey, rejectedResult);

            console.log(
              "⊘ read_file REJECTED — path not present in discovered repository inventory",
            );

            messages.push({
              role: "tool",
              toolCallId: toolCall.id,
              content: JSON.stringify(rejectedResult),
            });

            continue;
          }
        }
      }

      if (
        toolName === "run_counterfactual" &&
        counterfactualCalls >= MAX_COUNTERFACTUAL_EXPERIMENTS
      ) {
        console.log(
          "⊘ run_counterfactual BLOCKED — causal experiment budget exhausted",
        );

        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: JSON.stringify({
            ok: false,
            error:
              "Counterfactual experiment budget exhausted. Use the causal evidence already collected.",
          }),
        });

        continue;
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
              "Investigation test budget exhausted. Use the evidence already collected and end causal evidence collection.",
          }),
        });

        messages.push({
          role: "user",

          content:
            "You have enough execution evidence. Stop calling tools and end causal evidence collection now.",
        });

        forceCausalFinalization = true;

        continue;
      }

      console.log(`→ ${toolName}`, input);

      let result;

      try {
        if (toolName === "run_counterfactual") {
          const requestedExperimentId = getInputString(
            input,
            "experimentId",
          );

          if (
            requestedExperimentId &&
            executedExperiments.has(requestedExperimentId)
          ) {
            throw new Error(
              `Counterfactual experiment id "${requestedExperimentId}" was already used. Experiment evidence ids must be unique.`,
            );
          }

          const requestedHypothesisIds =
            typeof input === "object" &&
            input !== null &&
            "hypothesisIds" in input &&
            Array.isArray(input.hypothesisIds)
              ? input.hypothesisIds.filter(
                  (value): value is string => typeof value === "string",
                )
              : [];

          const boardHypothesisIds = new Set<string>(
            hypothesisBoard.hypotheses.map((hypothesis) => hypothesis.id),
          );

          const unknownHypothesisIds = requestedHypothesisIds.filter(
            (id) => !boardHypothesisIds.has(id),
          );

          if (unknownHypothesisIds.length > 0) {
            throw new Error(
              `Counterfactual experiment references hypothesis ids not present in the initial board: ${unknownHypothesisIds.join(", ")}.`,
            );
          }

          const evidence = await runCounterfactualExperiment(
            sandbox,
            input,
            {
              projectRoot,
              trustedCommand: baseline.command,
              baselineExitCode: baseline.exitCode,
              requiredOutput: baseline.requiredOutput,
              runnerConfigPaths: reconnaissance.runnerConfigs,
              testSetupPaths: reconnaissance.testSetups,
            },
          );

          counterfactualCalls++;
          executedExperiments.add(evidence.experimentId);
          counterfactualEvidence.push(evidence);

          result = {
            ok: true as const,
            data: evidence,
          };
        } else {
          result = await executeTool(sandbox, toolName, input);
        }
      } catch (error) {
        if (error instanceof Error && /restoration failed closed/i.test(error.message)) {
          throw error;
        }
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
        if (
          toolName === "list_files" &&
          "data" in result &&
          typeof result.data === "object" &&
          result.data !== null &&
          "files" in result.data &&
          Array.isArray(result.data.files)
        ) {
          for (const file of result.data.files) {
            if (typeof file === "string" && file.trim()) {
              discoveredFiles.add(
                file.replace(/\\/g, "/").replace(/^\.\//, "").trim(),
              );
            }
          }

          if (
            typeof input === "object" &&
            input !== null &&
            "depth" in input &&
            typeof input.depth === "number" &&
            Number.isInteger(input.depth)
          ) {
            discoveredDepth = Math.max(discoveredDepth, input.depth);
          }

          if (!causalContextHintSent) {
            const uninspectedCausalContext =
              findUninspectedCausalContext(
                [...discoveredFiles],
                [...inspectedFiles],
              );

            if (uninspectedCausalContext.length > 0) {
              shouldSendCausalContextHint = true;
            }
          }
        }

        if (toolName === "read_file" && "data" in result) {
          const filePath = getInputString(input, "path");
          const data = result.data;
          if (filePath && typeof data === "object" && data !== null &&
              "content" in data && typeof data.content === "string") {
            const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
            inspectedFiles.add(normalized);
            observedFiles.set(normalized, { path: normalized, content: data.content, truncated: false });
          }
        }

        if (toolName === "run_test" && "data" in result) {
          const selector = getInputString(input, "testName");
          if (selector) {
            observedTests.push({ selector, evidence: CommandEvidenceSchema.parse(result.data) });
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
    if (shouldSendCausalContextHint && !causalContextHintSent) {
      const uninspectedCausalContext =
        findUninspectedCausalContext(
          [...discoveredFiles],
          [...inspectedFiles],
        );

      if (uninspectedCausalContext.length > 0) {
        messages.push({
          role: "user",
          content: [
            "Repository discovery found environment files that may distinguish test infrastructure, configuration, and dependency/runtime causes:",
            ...uninspectedCausalContext.map((path) => `- ${path}`),
            "",
            "If your causal hypothesis involves those layers, prioritize inspecting this context before spending more calls on repeated implementation/test reads.",
            "A repair location is not proof that the same file owns the underlying cause.",
          ].join("\n"),
        });

        causalContextHintSent = true;
      }
    }

    if (forceCausalFinalization) {
      break;
    }
  }

  if (observedFiles.size === 0) {
    throw new Error("Causal investigation cannot finish without successfully inspected files.");
  }

  console.log("Causal evidence collection complete — assessing hypotheses without tools");
  const causalEvidence: CreateCausalFreezeInput = {
    issue,
    board: hypothesisBoard,
    baseline,
    files: [...observedFiles.values()],
    tests: observedTests,
    experiments: counterfactualEvidence,
  };
  const causalFreeze = await createCausalFreeze(causalEvidence);
  const report = [
    `Causal Freeze: ${causalFreeze.status}`,
    causalFreeze.causalClaim ?? "No causal selection is justified by the current evidence.",
    ...causalFreeze.hypothesisAssessments.map(
      (assessment) => `${assessment.hypothesisId}: ${assessment.status} — ${assessment.reason}`,
    ),
    ...causalFreeze.unresolvedQuestions.map((question) => `Unresolved: ${question}`),
  ].join("\n");

  return {
    completed: true as const,
    iterations: completedIterations,
    hypothesisBoard,
    experiments: counterfactualEvidence,
    causalFreeze,
    causalEvidence,
    discoveredFiles: [...discoveredFiles],
    report,
  };
}
