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
        decision.hypothesisAssessments.some((item) => item.status === "UNRESOLVED") ||
        decision.unresolvedQuestions.length > 0)
    ) {
      errors.push("HIGH confidence is not allowed with an UNKNOWN cause or unresolved causal questions/hypotheses.");
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
