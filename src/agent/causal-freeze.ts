import { z } from "zod";

import type { CounterfactualExperimentEvidence } from "../tools/run-counterfactual.js";
import { hypothesisBoardSchema, type HypothesisBoard } from "./hypothesis-board.js";
import { causeLayerSchema } from "./root-cause-contract.js";

const hypothesisIdSchema = z.string().regex(/^H[1-5]$/);

const causalEvidenceRefSchema = z
  .object({
    kind: z.enum(["FILE", "TEST", "EXPERIMENT"]),
    source: z.string().trim().min(1).max(500),
  })
  .strict();

const hypothesisAssessmentSchema = z
  .object({
    hypothesisId: hypothesisIdSchema,
    status: z.enum(["SUPPORTED", "WEAKENED", "UNRESOLVED"]),
    reason: z.string().trim().min(10).max(2000),
    evidenceRefs: z.array(causalEvidenceRefSchema).min(1).max(10),
  })
  .strict();

// Causal assessment only: repair targets and patch intents belong to the planner.
export const causalFreezeSchema = z
  .object({
    status: z.enum(["FROZEN", "NEEDS_MORE_EVIDENCE"]),
    hypothesisAssessments: z.array(hypothesisAssessmentSchema).min(2).max(5),
    selectedHypothesisId: hypothesisIdSchema.nullable(),
    causeLayer: causeLayerSchema.nullable(),
    causalClaim: z.string().trim().min(10).max(3000).nullable(),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH"]).nullable(),
    unresolvedQuestions: z.array(z.string().trim().min(5).max(1000)).max(8),
  })
  .strict();

export type CausalFreeze = z.infer<typeof causalFreezeSchema>;
export type CausalEvidenceRef = z.infer<typeof causalEvidenceRefSchema>;

export type FrozenCausalFreeze = CausalFreeze & {
  status: "FROZEN";
  selectedHypothesisId: string;
  causeLayer: NonNullable<CausalFreeze["causeLayer"]>;
  causalClaim: string;
  confidence: NonNullable<CausalFreeze["confidence"]>;
};

export type CausalFreezeGroundingContext = {
  // The original, already grounded pre-experiment board; never rewritten here.
  board: HypothesisBoard;
  // Host-observed FILE/TEST references, never a model-supplied evidence list.
  trustedEvidence: readonly {
    kind: "FILE" | "TEST";
    source: string;
  }[];
  // Successful tool results only, recorded after verified repository restoration.
  experiments: readonly CounterfactualExperimentEvidence[];
  // Host-ranked plans are predictions, not evidence. They are used only to
  // detect when an actual restored experiment contradicts a concrete prediction.
  experimentPlans?: readonly {
    selectedCandidateId: string | null;
    rankings: readonly {
      candidate: {
        id: string;
        predictions: readonly {
          hypothesisId: string;
          expectedOutcome:
            | "FAILURE_REMOVED"
            | "FAILURE_PERSISTS"
            | "UNKNOWN";
        }[];
      };
    }[];
    execution: {
      status: "COMPLETED" | "FAILED";
      evidenceSource: string | null;
      error: string | null;
    } | null;
  }[];
};

export const CAUSAL_FREEZE_JSON_SCHEMA = JSON.stringify(
  z.toJSONSchema(causalFreezeSchema),
  null,
  2,
);

export function parseCausalFreeze(text: string): CausalFreeze {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Causal freeze response was not valid JSON.");
  }

  const result = causalFreezeSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Causal freeze did not satisfy the structured contract: ${result.error.message}`,
    );
  }

  return result.data;
}

function evidenceKey(ref: { kind: string; source: string }) {
  return `${ref.kind}:${ref.source.trim()}`;
}

type ExperimentContradiction = {
  source: string;
  predictedOutcome: "FAILURE_REMOVED" | "FAILURE_PERSISTS";
  actualOutcome: "FAILURE_REMOVED" | "FAILURE_PERSISTS";
};

function experimentContradictions(
  context: CausalFreezeGroundingContext,
  suppliedExperiments?: Map<string, CounterfactualExperimentEvidence>,
) {
  const boardIds = new Set(context.board.hypotheses.map((item) => item.id));
  const experiments =
    suppliedExperiments ??
    new Map(
      context.experiments
        .filter((experiment) => {
          const source = experiment.evidenceSource.trim();
          return (
            experiment.repositoryRestored === true &&
            source === experiment.experimentId &&
            /^EXP-[1-9]\d*$/.test(source) &&
            experiment.hypothesisIds.length >= 2 &&
            new Set(experiment.hypothesisIds).size ===
              experiment.hypothesisIds.length &&
            experiment.hypothesisIds.every((id) => boardIds.has(id))
          );
        })
        .map((experiment) => [experiment.evidenceSource.trim(), experiment]),
    );

  const contradictions = new Map<string, ExperimentContradiction[]>();

  for (const plan of context.experimentPlans ?? []) {
    if (
      plan.execution?.status !== "COMPLETED" ||
      !plan.execution.evidenceSource ||
      !plan.selectedCandidateId
    ) {
      continue;
    }

    const experiment = experiments.get(plan.execution.evidenceSource);
    const selected = plan.rankings.find(
      (ranking) => ranking.candidate.id === plan.selectedCandidateId,
    )?.candidate;

    if (
      !experiment ||
      !selected ||
      experiment.outcome === "INCONCLUSIVE"
    ) {
      continue;
    }

    for (const prediction of selected.predictions) {
      if (
        prediction.expectedOutcome === "UNKNOWN" ||
        !experiment.hypothesisIds.includes(prediction.hypothesisId)
      ) {
        continue;
      }

      if (prediction.expectedOutcome !== experiment.outcome) {
        const items = contradictions.get(prediction.hypothesisId) ?? [];
        items.push({
          source: experiment.evidenceSource,
          predictedOutcome: prediction.expectedOutcome,
          actualOutcome: experiment.outcome,
        });
        contradictions.set(prediction.hypothesisId, items);
      }
    }
  }

  return contradictions;
}

/**
 * Experiment outcomes are host evidence. When a completed restored experiment
 * produces the opposite conclusive outcome from the selected plan prediction,
 * weakening that hypothesis is deterministic bookkeeping rather than model
 * reasoning. Apply it before validating or attempting citation-only repair.
 */
export function applyDeterministicExperimentContradictions(
  freeze: CausalFreeze,
  context: CausalFreezeGroundingContext,
): CausalFreeze {
  const normalized = causalFreezeSchema.parse(structuredClone(freeze));
  const contradictions = experimentContradictions(context);

  for (const assessment of normalized.hypothesisAssessments) {
    const items = contradictions.get(assessment.hypothesisId);

    if (!items?.length || assessment.status === "WEAKENED") {
      continue;
    }

    assessment.status = "WEAKENED";
    assessment.reason = items
      .map(
        (item) =>
          `Restored experiment ${item.source} produced ${item.actualOutcome}, opposite the selected plan prediction ${item.predictedOutcome} for ${assessment.hypothesisId}.`,
      )
      .join(" ");

    const existing = new Set(
      assessment.evidenceRefs.map(
        (ref) => `${ref.kind}:${ref.source}`,
      ),
    );

    for (const item of items) {
      const key = `EXPERIMENT:${item.source}`;

      if (!existing.has(key)) {
        assessment.evidenceRefs.push({
          kind: "EXPERIMENT",
          source: item.source,
        });
        existing.add(key);
      }
    }
  }

  if (
    normalized.status === "FROZEN" &&
    normalized.selectedHypothesisId !== null &&
    contradictions.has(normalized.selectedHypothesisId)
  ) {
    const contradictedSelection = normalized.selectedHypothesisId;
    normalized.status = "NEEDS_MORE_EVIDENCE";
    normalized.selectedHypothesisId = null;
    normalized.causeLayer = null;
    normalized.causalClaim = null;
    normalized.confidence = null;
    normalized.unresolvedQuestions = [
      `Restored experiment evidence contradicted selected hypothesis ${contradictedSelection}; reassess the remaining original hypotheses before repair planning.`,
    ];
  }

  return normalized;
}

/**
 * Checks provenance and decision consistency, not the truth of free-text claims.
 * A valid NEEDS_MORE_EVIDENCE result is not permission to begin repair planning.
 */
export function assertCausalFreezeGrounding(
  freeze: CausalFreeze,
  context: CausalFreezeGroundingContext,
): void {
  // Do not let direct callers bypass strict parsing with an unchecked assertion.
  const decision = causalFreezeSchema.parse(freeze);
  const board = hypothesisBoardSchema.parse(context.board);
  const errors: string[] = [];
  const hypotheses = new Map(board.hypotheses.map((item) => [item.id, item]));
  const availableEvidence = new Set(context.trustedEvidence.map(evidenceKey));
  const experiments = new Map<string, CounterfactualExperimentEvidence>();

  if (hypotheses.size !== board.hypotheses.length) {
    errors.push("Original Hypothesis Board contains duplicate hypothesis ids.");
  }

  for (const experiment of context.experiments) {
    const source = experiment.evidenceSource.trim();

    if (experiments.has(source)) {
      errors.push(`Duplicate experiment evidence source "${source}".`);
    }

    if (source !== experiment.experimentId || !/^EXP-[1-9]\d*$/.test(source)) {
      errors.push(`Experiment "${source}" has an inconsistent experiment id.`);
    }

    if (experiment.repositoryRestored !== true) {
      errors.push(`Experiment "${source}" did not verify repository restoration.`);
    }

    if (
      experiment.hypothesisIds.length < 2 ||
      new Set(experiment.hypothesisIds).size !== experiment.hypothesisIds.length ||
      experiment.hypothesisIds.some((id) => !hypotheses.has(id))
    ) {
      errors.push(`Experiment "${source}" must reference distinct original hypotheses.`);
    }

    experiments.set(source, experiment);
  }

  const contradictedHypotheses = experimentContradictions(
    context,
    experiments,
  );

  const assessedIds = new Set<string>();

  for (const assessment of decision.hypothesisAssessments) {
    const id = assessment.hypothesisId;
    const hypothesis = hypotheses.get(id);

    if (!hypothesis) {
      errors.push(`Assessment references unknown hypothesis id "${id}".`);
    }

    if (assessedIds.has(id)) {
      errors.push(`Duplicate assessment for hypothesis "${id}".`);
    }

    assessedIds.add(id);
    const seenRefs = new Set<string>();
    let hasIndependentSupport = false;

    for (const ref of assessment.evidenceRefs) {
      const key = evidenceKey(ref);

      if (seenRefs.has(key)) {
        errors.push(`Assessment "${id}" repeats evidence ${key}.`);
      }

      seenRefs.add(key);

      if (ref.kind !== "EXPERIMENT") {
        if (!availableEvidence.has(key)) {
          errors.push(`Assessment "${id}" references untrusted ${ref.kind} evidence "${ref.source}".`);
        } else {
          hasIndependentSupport = true;
        }

        continue;
      }

      const experiment = experiments.get(ref.source);

      if (!experiment) {
        errors.push(`Assessment "${id}" references EXPERIMENT "${ref.source}" that was not executed.`);
        continue;
      }

      if (!experiment.hypothesisIds.includes(id)) {
        errors.push(`EXPERIMENT "${ref.source}" did not address hypothesis "${id}".`);
        continue;
      }

      // No automatic mapping of outcome to support: the hypothesis may predict
      // either persistence or removal. Exclude only known insufficient grounds.
      const setupControlOnly =
        hypothesis?.layer === "TEST_INFRASTRUCTURE" &&
        experiment.intervention.role === "TEST_SETUP_CONTROL" &&
        experiment.outcome === "FAILURE_REMOVED";

      if (experiment.outcome !== "INCONCLUSIVE" && !setupControlOnly) {
        hasIndependentSupport = true;
      }
    }

    if (assessment.status === "SUPPORTED" && !hasIndependentSupport) {
      errors.push(
        `SUPPORTED hypothesis "${id}" needs independent evidence; INCONCLUSIVE experiments and failure-removing TEST_SETUP_CONTROL experiments alone cannot establish test-infrastructure causal ownership.`,
      );
    }

    const contradictions = contradictedHypotheses.get(id) ?? [];

    if (contradictions.length > 0 && assessment.status !== "WEAKENED") {
      errors.push(
        `Hypothesis "${id}" must be WEAKENED because restored experiment(s) ${contradictions.map((item) => item.source).join(", ")} produced the opposite conclusive outcome from the selected plan's prediction.`,
      );
    }
  }

  for (const id of hypotheses.keys()) {
    if (!assessedIds.has(id)) {
      errors.push(`Original hypothesis "${id}" has no assessment.`);
    }
  }

  if (decision.status === "FROZEN") {
    const selected = decision.hypothesisAssessments.find(
      (item) => item.hypothesisId === decision.selectedHypothesisId,
    );
    const selectedHypothesis = decision.selectedHypothesisId
      ? hypotheses.get(decision.selectedHypothesisId)
      : undefined;

    if (!selectedHypothesis || selected?.status !== "SUPPORTED") {
      errors.push("FROZEN requires one selected original hypothesis assessed as SUPPORTED.");
    }

    if (decision.causeLayer === null || decision.causalClaim === null || decision.confidence === null) {
      errors.push("FROZEN requires causeLayer, causalClaim, and confidence.");
    }

    if (selectedHypothesis && decision.causeLayer !== selectedHypothesis.layer) {
      errors.push("Frozen causeLayer must match the selected original hypothesis layer.");
    }

    if (
      decision.confidence === "HIGH" &&
      (decision.causeLayer === "UNKNOWN" ||
        decision.hypothesisAssessments.some((item) =>
          item.status === "UNRESOLVED" ||
          (item.hypothesisId !== decision.selectedHypothesisId && item.status === "SUPPORTED"),
        ) ||
        decision.unresolvedQuestions.length > 0)
    ) {
      errors.push("HIGH confidence is not allowed with an UNKNOWN cause, competing support, or unresolved causal questions/hypotheses.");
    }
  } else {
    if (
      decision.selectedHypothesisId !== null ||
      decision.causeLayer !== null ||
      decision.causalClaim !== null ||
      decision.confidence !== null
    ) {
      errors.push("NEEDS_MORE_EVIDENCE must leave selection, causeLayer, causalClaim, and confidence null.");
    }

    if (decision.unresolvedQuestions.length === 0) {
      errors.push("NEEDS_MORE_EVIDENCE must identify an unresolved causal question.");
    }
  }

  if (errors.length > 0) {
    throw new Error([
      "Causal Freeze v4 is not grounded.",
      ...errors.map((error) => `- ${error}`),
    ].join("\n"));
  }
}

/** Explicit gate: grounding a deferred decision must never authorize planning. */
export function assertCausalFreezeReadyForPlanning(
  freeze: CausalFreeze,
  context: CausalFreezeGroundingContext,
): asserts freeze is FrozenCausalFreeze {
  assertCausalFreezeGrounding(freeze, context);

  if (freeze.status !== "FROZEN") {
    throw new Error(
      `Repair planning is blocked: Causal Freeze needs more evidence. ${freeze.unresolvedQuestions.join(" ")}`,
    );
  }
}
