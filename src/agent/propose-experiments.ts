import type { ChatMessages } from "@openrouter/sdk/models";

import { openRouter, AGENT_MODEL } from "../ai/openrouter.js";
import { jsonSchemaResponseFormat } from "../ai/structured-output.js";
import { messageContentToText } from "./message-content.js";
import {
  experimentProposalResponseJsonSchema,
  experimentProposalSchema,
  priorityDirectBooleanInterventions,
  type ExperimentPlan,
  type PriorityDirectBooleanIntervention,
} from "./experiment-planner.js";
import type { CreateCausalFreezeInput } from "./create-causal-freeze.js";

const HOST_EXPERIMENT_SYSTEM_PROMPT = `
You are PatchVerdict's bounded counterfactual experiment proposer.

This is a planning-only phase. No tools are available and you must not propose a
repair. Use only the host-recorded evidence supplied in the request.

Propose at most three reversible single-variable experiments that can distinguish
the original hypotheses. Interventions may touch only the supplied runner-config
or shared test-setup paths. Use an exact find string that occurs once in the supplied
file content and a bounded replacement. Do not modify application code or direct
test files.

For every candidate, predict the outcome for every original hypothesis. Use
FAILURE_REMOVED, FAILURE_PERSISTS, or UNKNOWN. Predictions are assumptions for
ranking, not evidence. Cite only supplied evidence. Prefer candidates with opposing
concrete predictions; a candidate where every hypothesis predicts the same outcome
does not discriminate causes.

A TEST_SETUP_CONTROL that removes the failure demonstrates symptom suppression but
does not by itself prove that test infrastructure owns the root cause. Prefer a
RUNNER_CONFIGURATION intervention when it directly tests an upstream execution
hypothesis.

The candidate question and causalVariable must describe the actual path/find/replace
intervention. Never describe an edit to one file while proposing a mutation to another.
For cross-test DOM/state leakage, prioritize direct runner lifecycle/isolation variables
before downstream cleanup controls. Do not spend an experiment on mock-reset behavior
unless an original hypothesis specifically attributes the reproduced failure to mock
state and the observed evidence makes that mechanism plausible.

When PatchVerdict supplies priorityDirectInterventions, include every still-untried
priority intervention as a candidate with that exact path/find/replace. These are
host-observed boolean runner variables named by original hypotheses. You supply the
predictions and rationale; you may not substitute a nearby configuration flag.

If no safe, discriminating experiment remains, return candidates: [] and a concrete
stopReason. Never invent a path, observation, command, experiment result, or fix.
`.trim();

function sameIntervention(
  left: { path: string; find: string; replace: string },
  right: { path: string; find: string; replace: string },
) {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/^\.\//, "");

  return (
    normalize(left.path) === normalize(right.path) &&
    left.find === right.find &&
    left.replace === right.replace
  );
}

function wasAlreadyTried(
  priority: PriorityDirectBooleanIntervention,
  evidence: CreateCausalFreezeInput,
  previousPlans: readonly ExperimentPlan[],
) {
  return (
    evidence.experiments.some((experiment) =>
      sameIntervention(priority, experiment.intervention),
    ) ||
    previousPlans.some(
      (plan) => plan.request && sameIntervention(priority, plan.request),
    )
  );
}

export async function proposeExperiments(input: {
  evidence: CreateCausalFreezeInput;
  runnerConfigPaths: readonly string[];
  testSetupPaths: readonly string[];
  previousPlans: readonly ExperimentPlan[];
  focusQuestions?: readonly string[];
}) {
  const snapshot = structuredClone(input);
  const priorityDirectInterventions = priorityDirectBooleanInterventions({
    evidence: snapshot.evidence,
    runnerConfigPaths: snapshot.runnerConfigPaths,
  }).filter(
    (priority) =>
      !wasAlreadyTried(priority, snapshot.evidence, snapshot.previousPlans),
  );

  const messages: ChatMessages[] = [
    {
      role: "system",
      content: HOST_EXPERIMENT_SYSTEM_PROMPT,
    },
    {
      role: "user",
      content: JSON.stringify(
        {
          evidence: snapshot.evidence,
          allowedInterventionPaths: {
            runnerConfig: snapshot.runnerConfigPaths,
            testSetup: snapshot.testSetupPaths,
          },
          previousPlans: snapshot.previousPlans,
          focusQuestions: snapshot.focusQuestions ?? [],
          priorityDirectInterventions,
        },
        null,
        2,
      ),
    },
  ];

  const schema = experimentProposalResponseJsonSchema({
    evidence: snapshot.evidence,
    runnerConfigPaths: snapshot.runnerConfigPaths,
    testSetupPaths: snapshot.testSetupPaths,
  });

  const requestProposal = async (responseName: string) => {
    const response = await openRouter.chat.send({
      chatRequest: {
        model: AGENT_MODEL,
        messages,
        responseFormat: jsonSchemaResponseFormat(responseName, schema),
        stream: false,
      },
    });

    if (!("choices" in response)) {
      throw new Error("Expected a non-streaming experiment-planner response.");
    }

    const message = response.choices[0]?.message;
    if (!message) throw new Error("Model returned no experiment proposal.");
    if (message.toolCalls?.length) {
      throw new Error("Host experiment planning cannot execute tools.");
    }

    const text = messageContentToText(message.content);
    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Experiment proposal response was not valid JSON.");
    }

    const result = experimentProposalSchema.safeParse(parsed);
    if (!result.success) {
      throw new Error(
        `Experiment proposal did not satisfy the structured contract: ${result.error.message}`,
      );
    }

    messages.push(message);
    return result.data;
  };

  let proposal = await requestProposal("patchverdict_experiment_proposal");
  const missingPriority = priorityDirectInterventions.filter(
    (priority) =>
      !proposal.candidates.some((candidate) =>
        sameIntervention(priority, candidate),
      ),
  );

  if (missingPriority.length > 0) {
    messages.push({
      role: "user",
      content: [
        "PatchVerdict rejected the experiment set because it skipped host-observed direct runner variables named by the original hypotheses.",
        "Return a corrected proposal that includes every required intervention below with the exact path/find/replace. Keep at most three total candidates.",
        JSON.stringify(missingPriority, null, 2),
        "Do not replace these with nearby flags. Supply grounded predictions for every original hypothesis.",
      ].join("\n\n"),
    });

    proposal = await requestProposal(
      "patchverdict_experiment_proposal_direct_repair",
    );

    const stillMissing = priorityDirectInterventions.filter(
      (priority) =>
        !proposal.candidates.some((candidate) =>
          sameIntervention(priority, candidate),
        ),
    );

    if (stillMissing.length > 0) {
      throw new Error(
        `Experiment proposal omitted required direct runner intervention(s): ${stillMissing
          .map((item) => `${item.path}:${item.find}->${item.replace}`)
          .join(", ")}.`,
      );
    }
  }

  return proposal;
}
