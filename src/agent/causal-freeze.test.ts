import { describe, expect, it } from "vitest";

import type { CounterfactualExperimentEvidence } from "../tools/run-counterfactual.js";
import type { HypothesisBoard } from "./hypothesis-board.js";
import {
  applyDeterministicExperimentContradictions,
  assertCausalFreezeGrounding,
  assertCausalFreezeReadyForPlanning,
  causalFreezeSchema,
  parseCausalFreeze,
  type CausalFreeze,
  type CausalFreezeGroundingContext,
} from "./causal-freeze.js";

function createCase() {
  const board: HypothesisBoard = {
    observedFailure: "Rendered DOM persists between tests in the trusted baseline.",
    hypotheses: [
      {
        id: "H1",
        layer: "CONFIGURATION",
        hypothesis: "The runner configuration allows lifecycle state to persist between suites.",
        status: "OPEN",
        supportingEvidenceRefs: [{ kind: "FILE", source: "vite.config.ts" }],
        contradictingEvidenceRefs: [],
        missingEvidence: ["A controlled runner configuration experiment."],
      },
      {
        id: "H2",
        layer: "TEST_INFRASTRUCTURE",
        hypothesis: "The shared setup independently lacks the required cleanup lifecycle.",
        status: "OPEN",
        supportingEvidenceRefs: [{ kind: "FILE", source: "vitest.setup.ts" }],
        contradictingEvidenceRefs: [],
        missingEvidence: ["Evidence distinguishing missing setup from runtime behavior."],
      },
    ],
    discriminationGoal: {
      question: "Does the failure follow runner configuration or shared setup behavior?",
      competingHypothesisIds: ["H1", "H2"],
      evidenceNeeded: "Change one execution variable while preserving the original tests.",
    },
  };

  const experiment: CounterfactualExperimentEvidence = {
    experimentId: "EXP-1",
    evidenceSource: "EXP-1",
    hypothesisIds: ["H1", "H2"],
    question: "Does changing runner isolation remove the original failure?",
    intervention: {
      path: "vite.config.ts",
      role: "RUNNER_CONFIGURATION",
      find: "threads: false",
      replace: "threads: true",
    },
    command: { command: "npm test", exitCode: 0, stdout: "5 passed", stderr: "", durationMs: 10 },
    outcome: "FAILURE_REMOVED",
    repositoryRestored: true,
  };

  const context: CausalFreezeGroundingContext = {
    board,
    trustedEvidence: [
      { kind: "FILE", source: "vite.config.ts" },
      { kind: "FILE", source: "vitest.setup.ts" },
      { kind: "TEST", source: "npm test" },
    ],
    experiments: [experiment],
  };

  const freeze: CausalFreeze = {
    status: "FROZEN",
    hypothesisAssessments: [
      {
        hypothesisId: "H1",
        status: "SUPPORTED",
        reason: "Changing the runner mode removed the reproduced failure.",
        evidenceRefs: [{ kind: "EXPERIMENT", source: "EXP-1" }],
      },
      {
        hypothesisId: "H2",
        status: "WEAKENED",
        reason: "The same shared setup can pass under a different runner mode.",
        evidenceRefs: [{ kind: "EXPERIMENT", source: "EXP-1" }],
      },
    ],
    selectedHypothesisId: "H1",
    causeLayer: "CONFIGURATION",
    causalClaim: "Runner execution configuration causes lifecycle state to persist across suites.",
    confidence: "MEDIUM",
    unresolvedQuestions: [],
  };

  return { board, experiment, context, freeze };
}

function needsMoreEvidence(freeze: CausalFreeze): CausalFreeze {
  return {
    ...freeze,
    status: "NEEDS_MORE_EVIDENCE",
    hypothesisAssessments: freeze.hypothesisAssessments.map((item) => ({ ...item, status: "UNRESOLVED" })),
    selectedHypothesisId: null,
    causeLayer: null,
    causalClaim: null,
    confidence: null,
    unresolvedQuestions: ["Which lifecycle condition distinguishes the competing hypotheses?"],
  };
}

describe("Causal Freeze v4", () => {
  it("opens the explicit planning gate only for a grounded frozen decision", () => {
    const { freeze, context } = createCase();
    expect(() => assertCausalFreezeReadyForPlanning(freeze, context)).not.toThrow();
  });

  it("blocks planning for a valid NEEDS_MORE_EVIDENCE decision", () => {
    const { freeze, context } = createCase();
    const deferred = needsMoreEvidence(freeze);
    expect(() => assertCausalFreezeGrounding(deferred, context)).not.toThrow();
    expect(() => assertCausalFreezeReadyForPlanning(deferred, context)).toThrow(/Repair planning is blocked/);
  });

  it("revalidates evidence instead of trusting a FROZEN status at the planning gate", () => {
    const { freeze, context } = createCase();
    context.experiments = [];
    expect(() => assertCausalFreezeReadyForPlanning(freeze, context)).toThrow(/was not executed/);
  });

  it("accepts a grounded freeze without modifying the initial board or evidence", () => {
    const { freeze, context } = createCase();
    const before = structuredClone({ freeze, context });
    // Freeze nested host inputs too, so an attempted rewrite would throw.
    for (const hypothesis of context.board.hypotheses) Object.freeze(hypothesis);
    Object.freeze(context.board.hypotheses);
    Object.freeze(context.board);
    expect(() => assertCausalFreezeGrounding(freeze, context)).not.toThrow();
    expect({ freeze, context }).toEqual(before);
  });

  it("round-trips the strict structured decision", () => {
    const { freeze } = createCase();
    expect(parseCausalFreeze(JSON.stringify(freeze))).toEqual(freeze);
  });

  it("rejects invalid JSON with a useful error", () => {
    expect(() => parseCausalFreeze("not json")).toThrow(/not valid JSON/);
  });

  it("rejects missing required assessments", () => {
    const { freeze } = createCase();
    freeze.hypothesisAssessments = [];
    expect(() => parseCausalFreeze(JSON.stringify(freeze))).toThrow(/structured contract/);
  });

  it.each(["recommendedPatchTargets", "patchIntents", "repairKind"])(
    "rejects repair field %s even through the grounding entry point", (field) => {
      const { freeze, context } = createCase();
      expect(() => assertCausalFreezeGrounding({ ...freeze, [field]: [] }, context)).toThrow();
    },
  );

  it("rejects repair fields nested inside an assessment", () => {
    const { freeze } = createCase();
    const candidate = structuredClone(freeze);
    Object.assign(candidate.hypothesisAssessments[0]!, { authorizedPath: "vite.config.ts" });
    expect(() => causalFreezeSchema.parse(candidate)).toThrow();
  });

  it("rejects unknown assessment ids and omitted original hypotheses", () => {
    const { freeze, context } = createCase();
    freeze.hypothesisAssessments[1]!.hypothesisId = "H5";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/unknown hypothesis id "H5"/);
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/"H2" has no assessment/);
  });

  it("rejects duplicate assessments", () => {
    const { freeze, context } = createCase();
    freeze.hypothesisAssessments.push(structuredClone(freeze.hypothesisAssessments[0]!));
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/Duplicate assessment/);
  });

  it("rejects an ambiguous original board", () => {
    const { freeze, context } = createCase();
    context.board.hypotheses[1]!.id = "H1";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/Board contains duplicate/);
  });

  it.each(["FILE", "TEST"] as const)("rejects invented %s evidence", (kind) => {
    const { freeze, context } = createCase();
    freeze.hypothesisAssessments[0]!.evidenceRefs = [{ kind, source: "invented" }];
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/untrusted/);
  });

  it("does not confuse a file with an executed test of the same name", () => {
    const { freeze, context } = createCase();
    freeze.hypothesisAssessments[0]!.evidenceRefs = [{ kind: "TEST", source: "vite.config.ts" }];
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/untrusted TEST/);
  });

  it("accepts trusted file and test evidence without requiring an experiment", () => {
    const { freeze, context } = createCase();
    context.experiments = [];
    for (const assessment of freeze.hypothesisAssessments) {
      assessment.evidenceRefs = [...context.trustedEvidence];
    }
    expect(() => assertCausalFreezeGrounding(freeze, context)).not.toThrow();
  });

  it("host-normalizes a contradicted selected hypothesis into a deferred decision", () => {
    const { freeze, context, experiment } = createCase();

    context.experimentPlans = [
      {
        selectedCandidateId: "candidate-1",
        rankings: [
          {
            candidate: {
              id: "candidate-1",
              predictions: [
                {
                  hypothesisId: "H1",
                  expectedOutcome: "FAILURE_PERSISTS",
                },
                {
                  hypothesisId: "H2",
                  expectedOutcome: "FAILURE_REMOVED",
                },
              ],
            },
          },
        ],
        execution: {
          status: "COMPLETED",
          evidenceSource: experiment.evidenceSource,
          error: null,
        },
      },
    ];

    const normalized = applyDeterministicExperimentContradictions(
      freeze,
      context,
    );

    expect(normalized).toMatchObject({
      status: "NEEDS_MORE_EVIDENCE",
      selectedHypothesisId: null,
      causeLayer: null,
      causalClaim: null,
      confidence: null,
    });
    expect(normalized.hypothesisAssessments[0]).toMatchObject({
      hypothesisId: "H1",
      status: "WEAKENED",
    });
    expect(normalized.hypothesisAssessments[0]!.evidenceRefs).toContainEqual({
      kind: "EXPERIMENT",
      source: "EXP-1",
    });
    expect(normalized.unresolvedQuestions[0]).toContain("H1");
    expect(() =>
      assertCausalFreezeGrounding(normalized, context),
    ).not.toThrow();
  });

  it("requires a hypothesis to be WEAKENED when a selected experiment contradicts its prediction", () => {
    const { freeze, context, experiment } = createCase();

    context.experimentPlans = [
      {
        selectedCandidateId: "candidate-1",
        rankings: [
          {
            candidate: {
              id: "candidate-1",
              predictions: [
                {
                  hypothesisId: "H1",
                  expectedOutcome: "FAILURE_PERSISTS",
                },
                {
                  hypothesisId: "H2",
                  expectedOutcome: "FAILURE_REMOVED",
                },
              ],
            },
          },
        ],
        execution: {
          status: "COMPLETED",
          evidenceSource: experiment.evidenceSource,
          error: null,
        },
      },
    ];

    // Actual outcome is FAILURE_REMOVED, contradicting H1's concrete prediction.
    expect(() =>
      assertCausalFreezeGrounding(freeze, context),
    ).toThrow(/H1.*must be WEAKENED/i);

    freeze.hypothesisAssessments[0]!.status = "WEAKENED";
    freeze.status = "NEEDS_MORE_EVIDENCE";
    freeze.selectedHypothesisId = null;
    freeze.causeLayer = null;
    freeze.causalClaim = null;
    freeze.confidence = null;
    freeze.unresolvedQuestions = [
      "Which remaining hypothesis is supported after the contradiction?",
    ];

    expect(() =>
      assertCausalFreezeGrounding(freeze, context),
    ).not.toThrow();
  });

  it("rejects invented experiments", () => {
    const { freeze, context } = createCase();
    context.experiments = [];
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/was not executed/);
  });

  it("rejects duplicate experiment records", () => {
    const { freeze, context, experiment } = createCase();
    context.experiments = [experiment, structuredClone(experiment)];
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/Duplicate experiment evidence/);
  });

  it("rejects experiment aliases instead of host experiment ids", () => {
    const { freeze, context, experiment } = createCase();
    experiment.experimentId = "EXP-2";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/inconsistent experiment id/);
  });

  it("fails closed on an experiment without verified restoration", () => {
    const { freeze, context, experiment } = createCase();
    Object.assign(experiment, { repositoryRestored: false });
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/repository restoration/);
  });

  it("rejects experiments with unknown board hypotheses", () => {
    const { freeze, context, experiment } = createCase();
    experiment.hypothesisIds = ["H1", "H5"];
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/distinct original hypotheses/);
  });

  it("rejects citing an experiment for a hypothesis it did not address", () => {
    const { freeze, context, experiment } = createCase();
    context.board.hypotheses.push({ ...structuredClone(context.board.hypotheses[1]!), id: "H3" });
    freeze.hypothesisAssessments.push({ ...structuredClone(freeze.hypothesisAssessments[1]!), hypothesisId: "H3" });
    experiment.hypothesisIds = ["H1", "H2"];
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/did not address hypothesis "H3"/);
  });

  it("rejects duplicate evidence refs instead of counting them as extra support", () => {
    const { freeze, context } = createCase();
    freeze.hypothesisAssessments[0]!.evidenceRefs.push({ kind: "EXPERIMENT", source: "EXP-1" });
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/repeats evidence/);
  });

  it.each([null, "H5", "H2"])("rejects invalid frozen selection %s", (id) => {
    const { freeze, context } = createCase();
    freeze.selectedHypothesisId = id;
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/selected original hypothesis assessed as SUPPORTED/);
  });

  it.each(["causeLayer", "causalClaim", "confidence"] as const)("requires frozen %s", (field) => {
    const { freeze, context } = createCase();
    freeze[field] = null;
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/FROZEN requires causeLayer/);
  });

  it("rejects relabeling the selected cause layer after experiments", () => {
    const { freeze, context } = createCase();
    freeze.causeLayer = "TEST_INFRASTRUCTURE";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/match the selected original hypothesis layer/);
  });

  it("accepts a deferred decision with unresolved experiment evidence", () => {
    const { freeze, context, experiment } = createCase();
    experiment.outcome = "INCONCLUSIVE";
    expect(() => assertCausalFreezeGrounding(needsMoreEvidence(freeze), context)).not.toThrow();
  });

  it.each(["selectedHypothesisId", "causeLayer", "causalClaim", "confidence"] as const)(
    "rejects a deferred decision carrying frozen %s", (field) => {
      const { freeze, context } = createCase();
      const deferred = { ...needsMoreEvidence(freeze), [field]: freeze[field] };
      expect(() => assertCausalFreezeGrounding(deferred, context)).toThrow(/must leave selection/);
    },
  );

  it("requires a deferred decision to explain what evidence is missing", () => {
    const { freeze, context } = createCase();
    const deferred = needsMoreEvidence(freeze);
    deferred.unresolvedQuestions = [];
    expect(() => assertCausalFreezeGrounding(deferred, context)).toThrow(/identify an unresolved causal question/);
  });

  it("rejects support based only on an inconclusive experiment", () => {
    const { freeze, context, experiment } = createCase();
    experiment.outcome = "INCONCLUSIVE";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/needs independent evidence/);
  });

  it("allows an inconclusive experiment alongside independent trusted evidence", () => {
    const { freeze, context, experiment } = createCase();
    experiment.outcome = "INCONCLUSIVE";
    freeze.hypothesisAssessments[0]!.evidenceRefs.push({ kind: "FILE", source: "vite.config.ts" });
    expect(() => assertCausalFreezeGrounding(freeze, context)).not.toThrow();
  });

  it("does not infer test-infrastructure ownership solely from a successful setup control", () => {
    const { freeze, context, experiment } = createCase();
    experiment.intervention.role = "TEST_SETUP_CONTROL";
    freeze.hypothesisAssessments[0]!.status = "WEAKENED";
    freeze.hypothesisAssessments[1]!.status = "SUPPORTED";
    freeze.selectedHypothesisId = "H2";
    freeze.causeLayer = "TEST_INFRASTRUCTURE";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/TEST_SETUP_CONTROL/);
  });

  it("does not let inconclusive runner evidence rescue setup-control-only ownership", () => {
    const { freeze, context, experiment } = createCase();
    const inconclusive = { ...structuredClone(experiment), experimentId: "EXP-2", evidenceSource: "EXP-2", outcome: "INCONCLUSIVE" as const };
    experiment.intervention.role = "TEST_SETUP_CONTROL";
    context.experiments = [experiment, inconclusive];
    freeze.hypothesisAssessments[0]!.status = "WEAKENED";
    freeze.hypothesisAssessments[1]!.status = "SUPPORTED";
    freeze.hypothesisAssessments[1]!.evidenceRefs.push({ kind: "EXPERIMENT", source: "EXP-2" });
    freeze.selectedHypothesisId = "H2";
    freeze.causeLayer = "TEST_INFRASTRUCTURE";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/needs independent evidence/);
  });

  it("allows setup-control evidence when independent trusted evidence also supports the assessment", () => {
    const { freeze, context, experiment } = createCase();
    experiment.intervention.role = "TEST_SETUP_CONTROL";
    freeze.hypothesisAssessments[0]!.status = "WEAKENED";
    freeze.hypothesisAssessments[1]!.status = "SUPPORTED";
    freeze.hypothesisAssessments[1]!.evidenceRefs.push({ kind: "FILE", source: "vitest.setup.ts" });
    freeze.selectedHypothesisId = "H2";
    freeze.causeLayer = "TEST_INFRASTRUCTURE";
    expect(() => assertCausalFreezeGrounding(freeze, context)).not.toThrow();
  });

  it("does not automatically treat failure persistence as disproof", () => {
    const { freeze, context, experiment } = createCase();
    experiment.outcome = "FAILURE_PERSISTS";
    experiment.command.exitCode = 1;
    freeze.hypothesisAssessments[0]!.reason = "The predicted failure persists under the alternative runner condition.";
    expect(() => assertCausalFreezeGrounding(freeze, context)).not.toThrow();
  });

  it("permits HIGH confidence when the decision has no unresolved causal gaps", () => {
    const { freeze, context } = createCase();
    freeze.confidence = "HIGH";
    expect(() => assertCausalFreezeGrounding(freeze, context)).not.toThrow();
  });

  it("rejects HIGH confidence when a competing hypothesis is also supported", () => {
    const { freeze, context } = createCase();
    freeze.confidence = "HIGH";
    freeze.hypothesisAssessments[1]!.status = "SUPPORTED";
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/HIGH confidence is not allowed/);
  });

  it.each(["hypothesis", "question", "unknown layer"])("rejects HIGH confidence with unresolved %s", (gap) => {
    const { freeze, context } = createCase();
    freeze.confidence = "HIGH";
    if (gap === "hypothesis") freeze.hypothesisAssessments[1]!.status = "UNRESOLVED";
    if (gap === "question") freeze.unresolvedQuestions = ["Which lifecycle mechanism explains the observation?"];
    if (gap === "unknown layer") {
      context.board.hypotheses[0]!.layer = "UNKNOWN";
      freeze.causeLayer = "UNKNOWN";
    }
    expect(() => assertCausalFreezeGrounding(freeze, context)).toThrow(/HIGH confidence is not allowed/);
  });
});
