import type { Sandbox } from "e2b";
import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";

import { executeTool, type ToolName } from "../tools/index.js";

import { investigationToolDefinitions } from "./tool-definitions.js";

import {
  INVESTIGATION_OUTPUT_JSON_SCHEMA,
  INVESTIGATION_SYSTEM_PROMPT,
} from "./prompt.js";

import {
  parseInvestigationModelOutput,
  type InvestigationModelOutput,
} from "./investigation-contract.js";

import { messageContentToText } from "./message-content.js";
import { assertInvestigationProvenance } from "./investigation-provenance.js";
import type { InvestigationBaselineContext } from "./investigation-context.js";
import { assertPatchTargetAnalysis } from "./investigation-targeting.js";
import { assertPatchIntentContract } from "./investigation-intents.js";
import { assertFailureScopeAnalysis } from "./investigation-scope.js";
import { validateDiscoveredReadPath } from "./investigation-paths.js";
import { assertRootCauseAnalysisGrounding } from "./root-cause-contract.js";
import {
  assertCausalContextCoverage,
  findUninspectedCausalContext,
} from "./investigation-causal-context.js";
import { assertNoSemanticDriftDuringContractRepair } from "./investigation-repair-guard.js";
import {
  reconnaissanceForModel,
  type ReconnaissanceContext,
} from "./reconnaissance.js";
import { createInitialHypothesisBoard } from "./create-hypothesis-board.js";
import {
  runCounterfactualExperiment,
  type CounterfactualExperimentEvidence,
} from "../tools/run-counterfactual.js";

const MAX_ITERATIONS = 8;
const MAX_DUPLICATE_CALLS = 2;
const MAX_TEST_CALLS = 2;
const MAX_COUNTERFACTUAL_EXPERIMENTS = 2;

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

function assertFinalInvestigationContracts(
  structured: InvestigationModelOutput,
  context: {
    inspectedFiles: readonly string[];
    executedTests: readonly string[];
    executedTestCommands: readonly string[];
    searchQueries: readonly string[];
    trustedTestCommands: readonly string[];
    discoveredFiles: readonly string[];
    executedExperiments: readonly string[];
  },
) {
  assertInvestigationProvenance(structured.diagnosis, {
    inspectedFiles: context.inspectedFiles,
    executedTests: context.executedTests,
    executedTestCommands: context.executedTestCommands,
    searchQueries: context.searchQueries,
    trustedTestCommands: context.trustedTestCommands,
    executedExperiments: context.executedExperiments,
  });

  assertRootCauseAnalysisGrounding(
    structured.diagnosis.rootCauseAnalysis,
    structured.diagnosis.evidence,
    structured.diagnosis.confidence,
  );

  assertCausalContextCoverage(structured.diagnosis, {
    discoveredFiles: context.discoveredFiles,
    inspectedFiles: context.inspectedFiles,
  });

  assertFailureScopeAnalysis(structured.diagnosis, {
    inspectedFiles: context.inspectedFiles,
  });

  assertPatchTargetAnalysis(structured.diagnosis, {
    inspectedFiles: context.inspectedFiles,
  });

  assertPatchIntentContract(structured.diagnosis);
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
    "rootCauseAnalysis": {
      "failureMechanism": "Observable mechanism that produces the failure.",
      "primaryCause": {
        "layer": "UNKNOWN",
        "hypothesis": "The most likely underlying cause supported by current evidence.",
        "evidenceRefs": [
          {
            "kind": "FILE",
            "source": "src/example.ts"
          }
        ]
      },
      "alternatives": [
        {
          "layer": "TEST_FILE",
          "hypothesis": "A competing evidence-grounded cause hypothesis.",
          "status": "UNRESOLVED",
          "reason": "Why this alternative remains unresolved or why it was rejected.",
          "evidenceRefs": [
            {
              "kind": "FILE",
              "source": "src/example.ts"
            }
          ]
        }
      ]
    },
    "scopeAnalysis": {
      "scope": "UNKNOWN",
      "reason": "Evidence-supported explanation of whether the failure is local, shared, or still uncertain.",
      "evidenceRefs": [
        {
          "kind": "FILE",
          "source": "src/example.ts"
        }
      ]
    },
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
        "reason": "This location directly addresses the diagnosed root cause.",
        "evidenceRefs": [
          {
            "kind": "FILE",
            "source": "src/example.ts"
          }
        ]
      }
    ],
    "patchIntents": [
      {
        "id": "intent-1",
        "path": "src/example.ts",
        "objective": "Correct the behavior identified by the investigation.",
        "repairKind": "MITIGATION",
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
FILE, TEST, SEARCH, EXPERIMENT

Allowed confidence values:
LOW, MEDIUM, HIGH

Allowed failure scope values:
LOCAL, SHARED, UNKNOWN

Allowed patch-target decisions:
RECOMMEND, REJECT

Allowed cause layers:
APPLICATION_CODE, CONFIGURATION, DEPENDENCY_RUNTIME, TEST_INFRASTRUCTURE, TEST_SUPPORT, TEST_FILE, UNKNOWN

Allowed repair kinds:
ROOT_CAUSE_FIX, WORKAROUND, MITIGATION

Root-cause rules:

- rootCauseAnalysis.failureMechanism describes how the failure occurs, not merely where it appears
- primaryCause.layer must identify the layer that owns the underlying cause, or UNKNOWN when evidence is insufficient
- every rootCauseAnalysis evidenceRefs entry must exactly match diagnosis.evidence
- DEPENDENCY_RUNTIME must cite TEST or EXPERIMENT evidence
- UNKNOWN primary cause cannot use HIGH confidence
- HIGH confidence is not allowed while any competing cause remains UNRESOLVED
- consider plausible alternatives and mark them REJECTED or UNRESOLVED rather than silently collapsing competing explanations
- every alternatives entry must include exactly layer, hypothesis, status, reason, and evidenceRefs
- if no grounded alternative exists, use alternatives: [] rather than a partial alternative object
- do not label a workaround or mitigation as ROOT_CAUSE_FIX
- no patch intent may be ROOT_CAUSE_FIX while a competing cause remains UNRESOLVED

Failure-scope rules:

- scope must be LOCAL, SHARED, or UNKNOWN
- scopeAnalysis evidenceRefs must exactly match diagnosis.evidence
- scopeAnalysis must cite at least one FILE evidence entry
- UNKNOWN scope cannot use HIGH confidence
- LOCAL or SHARED scope must be supported by evidence, not inferred only from where the failure surfaced
- SHARED scope must cite at least one TEST evidence entry and FILE evidence outside a direct test file
- LOCAL scope must cite every inspected TEST_INFRASTRUCTURE or TEST_SUPPORT candidate so shared scope is ruled out explicitly
- a passing isolated test may support order-dependence but does not by itself prove LOCAL or SHARED scope
- do not claim multiple affected tests/components/consumers unless the cited evidence actually demonstrates those affected cases
- if scopeAnalysis.reason relies on baseline/runtime behavior, include the matching TEST evidenceRef

Patch-target decision rules:

- every patchTargetAnalysis entry must include evidenceRefs
- every patchTargetAnalysis evidenceRefs entry must exactly match diagnosis.evidence
- every patchTargetAnalysis entry must include FILE evidence for its own path
- do not claim LOCAL/SHARED/isolated/global scope unless the cited evidence supports that claim

Patch-intent rules:

- intent ids must use intent-1, intent-2, and so on
- every patch intent path must be a recommendedPatchTargets path
- every patch intent path must be marked RECOMMEND in patchTargetAnalysis
- every evidenceRefs entry must exactly match evidence already present in diagnosis.evidence
- patch intent objectives should describe required behavior, not exact implementation syntax or API calls
- every patch intent must include repairKind: ROOT_CAUSE_FIX, WORKAROUND, or MITIGATION
- repairKind must be compatible with rootCauseAnalysis.primaryCause.layer and the target's verification role
- do not introduce a repair objective that is unrelated to the diagnosed root cause

Do not use Markdown fences.
Do not call tools.
Do not include additional fields.

Authoritative JSON Schema generated from PatchVerdict's runtime contract:

${INVESTIGATION_OUTPUT_JSON_SCHEMA}
`.trim(),
    });

    console.log(
      [
        "⊘ STRUCTURED INVESTIGATION JSON REJECTED — requesting one no-tool schema repair",
        "",
        reason,
      ].join("\n"),
    );

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
     * No second schema-repair attempt.
     * If this fails, the investigation fails closed
     * rather than silently accepting malformed data.
     */
    try {
      return parseInvestigationModelOutput(repairedText);
    } catch (repairError) {
      const repairReason =
        repairError instanceof Error
          ? repairError.message
          : "Unknown structured-output repair error";

      throw new Error(
        [
          "Investigation structured-output repair failed after one no-tool attempt.",
          `Initial validation: ${reason}`,
          `Repair validation: ${repairReason}`,
        ].join("\n"),
      );
    }
  }
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
  let forceFinalReport = false;
  let completedIterations = 0;
  const inspectedFiles = new Set<string>(
    reconnaissance.preInspectedFiles,
  );

  const executedTests = new Set<string>();

  const executedTestCommands = new Set<string>();

  const searchQueries = new Set<string>();

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
        assertFinalInvestigationContracts(structured, {
          inspectedFiles: [...inspectedFiles],
          executedTests: [...executedTests],
          executedTestCommands: [...executedTestCommands],
          searchQueries: [...searchQueries],
          trustedTestCommands: [baseline.command],
          discoveredFiles: [...discoveredFiles],
          executedExperiments: [...executedExperiments],
        });
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
- EXPERIMENT evidence source must be the exact experimentId returned by a successful run_counterfactual call
- failure scope is explicitly classified as LOCAL, SHARED, or UNKNOWN
- failure-scope evidenceRefs exactly match existing diagnosis evidence
- every patchTargetAnalysis entry cites existing diagnosis evidence
- every patchTargetAnalysis entry includes FILE evidence for its own path
- every recommended patch target has at least one patchIntents entry
- every patch intent targets a RECOMMEND path
- every patch intent evidenceRefs entry exactly matches existing diagnosis evidence
- rootCauseAnalysis is grounded in existing diagnosis evidence
- HIGH-confidence or ROOT_CAUSE_FIX claims about TEST_INFRASTRUCTURE, CONFIGURATION, or DEPENDENCY_RUNTIME must inspect and account for discovered package/test-runner context
- absence of a compensating hook in a patch target is not, by itself, proof that the target owns the underlying cause
- every patch intent repairKind is compatible with the identified primary cause

Do not invent paths, evidence, or unrelated patch objectives.
`.trim(),
        });

        continue;
      }

      return {
        completed: true,
        iterations: iteration,
        hypothesisBoard,
        experiments: counterfactualEvidence,
        report: structured.report,
        diagnosis: structured.diagnosis,
      };
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
                  "Before making a HIGH-confidence or ROOT_CAUSE_FIX claim about test infrastructure, configuration, or dependency/runtime behavior, inspect the discovered package/test-runner context listed here if it can distinguish competing causes.",
              }),
            },
          }),
        });

        if (!preloaded && duplicateCalls >= MAX_DUPLICATE_CALLS) {
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
              allowedPaths: [
                ...reconnaissance.runnerConfigs,
                ...reconnaissance.testSetups,
              ],
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
    content: `
The investigation tool budget is exhausted. You may not call any more tools.

Based only on the evidence already collected, provide your final investigation report now.

Before returning the JSON, re-check all PatchVerdict contracts:

- every relevant file and recommended target must be grounded in observed evidence
- failure scope must be LOCAL, SHARED, or UNKNOWN and grounded in existing evidence
- SHARED scope must include TEST evidence and non-direct-test FILE evidence
- LOCAL scope must explicitly cite every inspected TEST_INFRASTRUCTURE or TEST_SUPPORT candidate
- scopeAnalysis.reason may only summarize facts supported by its evidenceRefs
- runtime/baseline scope claims must cite the matching TEST evidenceRef
- UNKNOWN scope cannot use HIGH confidence
- if recommending a direct test file after inspecting test infrastructure, explicitly account for every inspected test-infrastructure candidate in patchTargetAnalysis
- rootCauseAnalysis must separate failure mechanism from underlying cause
- do not infer the cause layer from the easiest patch location
- when discovered package/test-runner context could distinguish TEST_INFRASTRUCTURE, CONFIGURATION, and DEPENDENCY_RUNTIME, inspect and account for it before HIGH confidence or ROOT_CAUSE_FIX
- if that context was not inspected, prefer uncertainty plus WORKAROUND/MITIGATION over fabricated causal certainty
- unresolved competing causes must prevent HIGH confidence and ROOT_CAUSE_FIX classification
- every alternative cause entry must include layer, hypothesis, status, reason, and evidenceRefs
- use alternatives: [] instead of a partial alternative object
- every rootCauseAnalysis evidenceRef must already exist in diagnosis.evidence
- every RECOMMEND target must have a grounded patchIntent with an explicit repairKind
- do not invent new evidence, files, tests, experiments, commands, or patch objectives

Return only the final structured JSON.
`.trim(),
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

  let structured = await parseFinalInvestigation(
    messages,
    finalMessage.content,
  );

  const finalizationContext = {
    inspectedFiles: [...inspectedFiles],
    executedTests: [...executedTests],
    executedTestCommands: [...executedTestCommands],
    searchQueries: [...searchQueries],
    trustedTestCommands: [baseline.command],
    discoveredFiles: [...discoveredFiles],
    executedExperiments: [...executedExperiments],
  };

  try {
    assertFinalInvestigationContracts(structured, finalizationContext);
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "Unknown final investigation validation error";

    console.log(
      [
        "⊘ FINAL REPORT REJECTED AFTER BUDGET — requesting one no-tool contract repair",
        "",
        reason,
      ].join("\n"),
    );

    messages.push({
      role: "user",
      content: `
PatchVerdict rejected your final structured diagnosis.

Validation error:

${reason}

You may not call tools. Revise the JSON only from evidence already collected.

Important:

- do not invent evidence, experiments, or claim new observations
- do not add files that were not successfully inspected
- if a direct TEST_FILE is recommended after TEST_INFRASTRUCTURE was inspected, every inspected test-infrastructure candidate must be explicitly represented in relevantFiles and patchTargetAnalysis as RECOMMEND or REJECT
- every patchTargetAnalysis entry must cite existing evidence and include FILE evidence for its own path
- rootCauseAnalysis must remain grounded in diagnosis.evidence
- do not use unobserved external-library/API behavior as if it were repository evidence
- if package/test-runner context was discovered but not inspected, do not preserve a HIGH-confidence or ROOT_CAUSE_FIX claim about test infrastructure/configuration/runtime
- every alternative cause must include layer, hypothesis, status, reason, and evidenceRefs
- never keep a partial alternative object; use alternatives: [] if no grounded alternative exists
- do not change the primary cause layer/hypothesis, alternatives, scope, evidence ledger, targets, patch intent path/objective/repairKind, or confidence during this no-tool repair
- only repair evidenceRefs or explanatory reason/report text using evidence already collected
- every recommended target must have a matching grounded patchIntent
- every patchIntent must keep an evidence-grounded repairKind
- every patchIntent evidenceRefs entry must exactly match diagnosis.evidence

Return only corrected structured JSON.
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
        "Expected a non-streaming final investigation contract repair response",
      );
    }

    const repairMessage = repairResponse.choices[0]?.message;

    if (!repairMessage) {
      throw new Error(
        "Model returned no final investigation contract repair response",
      );
    }

    messages.push(repairMessage);

    const repairedStructured = await parseFinalInvestigation(
      messages,
      repairMessage.content,
    );

    assertNoSemanticDriftDuringContractRepair(
      structured.diagnosis,
      repairedStructured.diagnosis,
    );

    structured = repairedStructured;

    /*
     * Exactly one semantic contract-repair attempt.
     * If this still fails, the mission fails closed.
     */
    assertFinalInvestigationContracts(structured, finalizationContext);
  }

  return {
    completed: true,

    iterations: completedIterations,

    hypothesisBoard,

    experiments: counterfactualEvidence,

    report: structured.report,

    diagnosis: structured.diagnosis,
  };
}
