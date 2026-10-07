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
import { CausalFreezeError, createCausalFreeze, type CreateCausalFreezeInput } from "./create-causal-freeze.js";
import { planExperiments, type ExperimentPlan } from "./experiment-planner.js";
import { proposeExperiments } from "./propose-experiments.js";
import { runCounterfactualExperiment, type CounterfactualExperimentEvidence } from "../tools/run-counterfactual.js";

const MAX_MODEL_TURNS = 8;
const MAX_TOOL_CALLS = 24;
const MAX_EXPERIMENT_PLANNING_ROUNDS = 3;
const MAX_DUPLICATE_CALLS = 2;
const MAX_TEST_CALLS = 2;
const MAX_COUNTERFACTUAL_EXPERIMENTS = 2;
const ALLOWED_TOOLS = new Set(investigationToolDefinitions.map((tool) => tool.function.name));

export class InvestigationEvidenceError extends Error {
  constructor(readonly evidence: CreateCausalFreezeInput, readonly iterations: number, message: string) {
    super(message);
    this.name = "InvestigationEvidenceError";
  }
}
export class CausalInvestigationError extends InvestigationEvidenceError {
  constructor(readonly freezeError: CausalFreezeError, iterations: number) {
    super(freezeError.evidence, iterations, freezeError.message);
    this.name = "CausalInvestigationError";
  }
}

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
- Use plan_experiments to compare up to three single-variable interventions. Predict the outcome for every original hypothesis, grounded in observed evidence; use UNKNOWN when uncertain. The host ranks information gain and executes only the selected experiment.
- Propose distinct predictions, not several variations of the same symptom-suppression fix. Submit no candidates with a stopReason when no useful experiment remains.
- Budgets are ceilings, not quotas: at most 8 model turns, 24 tool calls, 2 targeted test executions, 3 planning rounds, and 2 experiment attempts. Stop early when further evidence would not discriminate causes.
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
  let toolCallsUsed = 0;
  let stopReason = "MODEL_TURN_BUDGET";
  const experimentPlans: ExperimentPlan[] = [];
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

  const counterfactualEvidence: CounterfactualExperimentEvidence[] = [];

  const discoveredFiles = new Set<string>(
    reconnaissance.inventory,
  );

  let discoveredDepth = reconnaissance.inventoryDepth;

  let causalContextHintSent = false;

  const evidenceSnapshot = (): CreateCausalFreezeInput => ({
    issue,
    board: hypothesisBoard,
    baseline,
    files: [...observedFiles.values()],
    tests: observedTests,
    experiments: counterfactualEvidence,
    experimentPlanning: {
      plans: experimentPlans, stopReason,
      usage: { modelTurns: completedIterations, toolCalls: toolCallsUsed, testExecutions: testCalls, experimentExecutions: counterfactualCalls },
    },
  });

  const hasExperimentSurface = () =>
    [...reconnaissance.runnerConfigs, ...reconnaissance.testSetups].some(
      (filePath) => {
        const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
        const file = observedFiles.get(normalized);
        return file !== undefined && !file.truncated;
      },
    );

  const canHostPlanExperiment = () =>
    hasExperimentSurface() &&
    counterfactualCalls < MAX_COUNTERFACTUAL_EXPERIMENTS &&
    experimentPlans.length < MAX_EXPERIMENT_PLANNING_ROUNDS;

  const runHostPlannedExperiment = async (
    focusQuestions: readonly string[] = [],
  ): Promise<boolean> => {
    if (!canHostPlanExperiment()) {
      return false;
    }

    console.log("");
    console.log("HOST EXPERIMENT PLANNER");
    console.log(
      focusQuestions.length > 0
        ? "Causal Freeze requested more evidence — planning one bounded follow-up experiment..."
        : "Planning one bounded counterfactual from collected evidence...",
    );

    const snapshot = evidenceSnapshot();

    let proposal: unknown;

    try {
      proposal = await proposeExperiments({
        evidence: snapshot,
        runnerConfigPaths: reconnaissance.runnerConfigs,
        testSetupPaths: reconnaissance.testSetups,
        previousPlans: experimentPlans,
        focusQuestions,
      });
    } catch (error) {
      stopReason = "HOST_EXPERIMENT_PLANNER_FAILED";
      console.log(
        `⊘ host experiment planner unavailable — ${error instanceof Error ? error.message : "unknown error"}`,
      );
      return false;
    }

    const plan = planExperiments(proposal, {
      evidence: snapshot,
      runnerConfigPaths: reconnaissance.runnerConfigs,
      testSetupPaths: reconnaissance.testSetups,
      previousPlans: experimentPlans,
      remainingExecutions:
        MAX_COUNTERFACTUAL_EXPERIMENTS - counterfactualCalls,
      maxPlanningRounds: MAX_EXPERIMENT_PLANNING_ROUNDS,
      nextExperimentId: `EXP-${counterfactualCalls + 1}`,
    });

    experimentPlans.push(plan);

    if (!plan.request) {
      stopReason = "HOST_EXPERIMENT_PLANNER_STOP";
      console.log(`⊘ no executable counterfactual selected — ${plan.reason}`);
      return false;
    }

    console.log(
      `Selected ${plan.selectedCandidateId}: ${plan.request.question}`,
    );

    counterfactualCalls++;

    try {
      const evidence = await runCounterfactualExperiment(
        sandbox,
        plan.request,
        {
          projectRoot,
          trustedCommand: baseline.command,
          baselineExitCode: baseline.exitCode,
          requiredOutput: baseline.requiredOutput,
          runnerConfigPaths: reconnaissance.runnerConfigs,
          testSetupPaths: reconnaissance.testSetups,
        },
      );

      counterfactualEvidence.push(evidence);
      plan.execution = {
        status: "COMPLETED",
        evidenceSource: evidence.evidenceSource,
        error: null,
      };
      stopReason = "HOST_EXPERIMENT_EXECUTED";

      console.log(
        `← ${evidence.experimentId}: ${evidence.outcome} | ${evidence.intervention.role} | hypotheses ${evidence.hypothesisIds.join(", ")} | repository restored: ${evidence.repositoryRestored}`,
      );

      return true;
    } catch (error) {
      plan.execution = {
        status: "FAILED",
        evidenceSource: null,
        error: error instanceof Error ? error.message : "Experiment failed",
      };

      stopReason = "HOST_EXPERIMENT_FAILED";

      if (
        error instanceof Error &&
        /restoration failed closed/i.test(error.message)
      ) {
        throw error;
      }

      console.log(
        `⊘ host counterfactual failed — ${error instanceof Error ? error.message : "unknown error"}`,
      );

      return false;
    }
  };

  try {
    for (let iteration = 1; iteration <= MAX_MODEL_TURNS; iteration++) {
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
        stopReason = "COLLECTOR_FINISHED";
        break;
      }

      let shouldSendCausalContextHint = false;

      for (const toolCall of toolCalls) {
        if (forceCausalFinalization) break;
        if (toolCallsUsed >= MAX_TOOL_CALLS) {
          stopReason = "TOOL_CALL_BUDGET";
          forceCausalFinalization = true;
          break;
        }
        toolCallsUsed++;
        const toolName = toolCall.function.name as
          | ToolName
          | "plan_experiments";

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

            stopReason = "DUPLICATE_CALL_BUDGET";
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
                "Investigation test execution budget exhausted. Do not call run_test again. You may still inspect repository evidence with read_file/search_code or end causal evidence collection.",
            }),
          });

          messages.push({
            role: "user",

            content:
              "The run_test execution budget is exhausted. Do not call run_test again. Use remaining model turns only for non-executing evidence inspection (for example read_file/search_code) if it can distinguish the hypotheses, otherwise end causal evidence collection.",
          });

          stopReason = "TEST_EXECUTION_BUDGET";

          continue;
        }

        console.log(`→ ${toolName}`, input);

        let result;
        let experimentSummary: string | undefined;

        try {
          if (toolName === "plan_experiments") {
            const plan = planExperiments(input, {
              evidence: {
                issue, board: hypothesisBoard, baseline, files: [...observedFiles.values()],
                tests: observedTests, experiments: counterfactualEvidence,
              },
              runnerConfigPaths: reconnaissance.runnerConfigs, testSetupPaths: reconnaissance.testSetups,
              previousPlans: experimentPlans, remainingExecutions: MAX_COUNTERFACTUAL_EXPERIMENTS - counterfactualCalls,
              maxPlanningRounds: MAX_EXPERIMENT_PLANNING_ROUNDS, nextExperimentId: `EXP-${counterfactualCalls + 1}`,
            });
            experimentPlans.push(plan);
            if (!plan.request) {
              result = { ok: plan.status === "STOPPED", data: plan };
              experimentSummary = `${plan.status}: ${plan.reason}`;
              if (plan.status === "STOPPED" || experimentPlans.length >= MAX_EXPERIMENT_PLANNING_ROUNDS) {
                stopReason = "EXPERIMENT_PLANNER_STOP";
                forceCausalFinalization = true;
              }
            } else {
              counterfactualCalls++; // Attempts, including failed/inconclusive commands, consume budget.
              try {
                const evidence = await runCounterfactualExperiment(sandbox, plan.request, {
                  projectRoot, trustedCommand: baseline.command, baselineExitCode: baseline.exitCode,
                  requiredOutput: baseline.requiredOutput, runnerConfigPaths: reconnaissance.runnerConfigs,
                  testSetupPaths: reconnaissance.testSetups,
                });
                counterfactualEvidence.push(evidence);
                plan.execution = { status: "COMPLETED", evidenceSource: evidence.evidenceSource, error: null };
                experimentSummary = `${evidence.experimentId}: ${evidence.outcome} | ${evidence.intervention.role} | hypotheses ${evidence.hypothesisIds.join(", ")} | exit ${evidence.command.exitCode} | repository restored: ${evidence.repositoryRestored}`;
                result = { ok: true as const, data: { plan, evidence } };
              } catch (error) {
                plan.execution = { status: "FAILED", evidenceSource: null, error: error instanceof Error ? error.message : "Experiment failed" };
                throw error;
              }
            }
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

        console.log(`← ${toolName}`, result.ok ? experimentSummary ?? "OK" : "ERROR");

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

        if (toolName === "run_test") {
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

  } catch (error) {
    stopReason = "COLLECTION_FAILED";
    throw new InvestigationEvidenceError(evidenceSnapshot(), completedIterations,
      error instanceof Error ? error.message : "Evidence collection failed");
  }

  if (observedFiles.size === 0) {
    throw new InvestigationEvidenceError(evidenceSnapshot(), completedIterations, "Causal investigation cannot finish without successfully inspected files.");
  }

  // M4 is a host-managed phase. The collector may request experiments itself,
  // but forgetting to do so must not silently skip the causal experiment stage.
  if (
    counterfactualEvidence.length === 0 &&
    experimentPlans.length === 0 &&
    canHostPlanExperiment()
  ) {
    try {
      await runHostPlannedExperiment();
    } catch (error) {
      stopReason = "COLLECTION_FAILED";
      throw new InvestigationEvidenceError(
        evidenceSnapshot(),
        completedIterations,
        error instanceof Error ? error.message : "Host experiment failed",
      );
    }
  }

  console.log("Causal evidence collection complete — assessing hypotheses without tools");

  let causalEvidence = evidenceSnapshot();
  let causalFreeze = await createCausalFreeze(causalEvidence).catch((error: unknown) => {
    if (error instanceof CausalFreezeError) {
      throw new CausalInvestigationError(error, completedIterations);
    }
    throw error;
  });

  // A deferred freeze may unlock exactly one more bounded experiment using its
  // explicit unresolved questions. No unbounded investigate-plan-freeze loop.
  if (
    causalFreeze.status === "NEEDS_MORE_EVIDENCE" &&
    counterfactualEvidence.length > 0 &&
    canHostPlanExperiment()
  ) {
    let executed = false;

    try {
      executed = await runHostPlannedExperiment(
        causalFreeze.unresolvedQuestions,
      );
    } catch (error) {
      stopReason = "COLLECTION_FAILED";
      throw new InvestigationEvidenceError(
        evidenceSnapshot(),
        completedIterations,
        error instanceof Error ? error.message : "Follow-up experiment failed",
      );
    }

    if (executed) {
      console.log("Reassessing causality with the new counterfactual evidence...");
      causalEvidence = evidenceSnapshot();
      causalFreeze = await createCausalFreeze(causalEvidence).catch((error: unknown) => {
        if (error instanceof CausalFreezeError) {
          throw new CausalInvestigationError(error, completedIterations);
        }
        throw error;
      });
    }
  }

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
