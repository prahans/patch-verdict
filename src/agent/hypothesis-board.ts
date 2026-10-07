import { z } from "zod";

import { causeLayerSchema } from "./root-cause-contract.js";

const hypothesisIdSchema = z
  .string()
  .regex(/^H[1-5]$/, "Hypothesis ids must use H1 through H5.");

const hypothesisEvidenceRefSchema = z
  .object({
    kind: z.enum(["FILE", "TEST"]),
    source: z.string().trim().min(1).max(500),
  })
  .strict();

const hypothesisSchema = z
  .object({
    id: hypothesisIdSchema,
    layer: causeLayerSchema,
    hypothesis: z.string().trim().min(10).max(3000),
    status: z.literal("OPEN"),
    supportingEvidenceRefs: z.array(hypothesisEvidenceRefSchema).max(10),
    contradictingEvidenceRefs: z.array(hypothesisEvidenceRefSchema).max(10),
    missingEvidence: z
      .array(z.string().trim().min(5).max(1000))
      .max(8),
  })
  .strict();

const discriminationGoalSchema = z
  .object({
    question: z.string().trim().min(10).max(2000),
    competingHypothesisIds: z.array(hypothesisIdSchema).min(2).max(5),
    evidenceNeeded: z.string().trim().min(10).max(2000),
  })
  .strict();

export const hypothesisBoardSchema = z
  .object({
    observedFailure: z.string().trim().min(10).max(3000),
    hypotheses: z.array(hypothesisSchema).min(2).max(5),
    discriminationGoal: discriminationGoalSchema,
  })
  .strict();

export type HypothesisEvidenceRef = z.infer<
  typeof hypothesisEvidenceRefSchema
>;

export type Hypothesis = z.infer<typeof hypothesisSchema>;

export type HypothesisBoard = z.infer<typeof hypothesisBoardSchema>;

export const HYPOTHESIS_BOARD_JSON_SCHEMA = JSON.stringify(
  z.toJSONSchema(hypothesisBoardSchema),
  null,
  2,
);

export function hypothesisBoardResponseJsonSchema(context: {
  baselineCommand: string;
  preInspectedFiles: readonly string[];
}): Record<string, unknown> {
  const baselineCommand = context.baselineCommand.trim();

  const fileSources = [
    ...new Set(
      context.preInspectedFiles
        .map((filePath) => filePath.trim())
        .filter(Boolean),
    ),
  ];

  const testRefSchema = z
    .object({
      kind: z.literal("TEST"),
      source: z.literal(baselineCommand),
    })
    .strict();

  const evidenceRefSchema =
    fileSources.length === 0
      ? testRefSchema
      : z.discriminatedUnion("kind", [
          z
            .object({
              kind: z.literal("FILE"),
              source: z.enum(fileSources as [string, ...string[]]),
            })
            .strict(),
          testRefSchema,
        ]);

  const constrainedHypothesisSchema = hypothesisSchema.extend({
    supportingEvidenceRefs: z.array(evidenceRefSchema).max(10),
    contradictingEvidenceRefs: z.array(evidenceRefSchema).max(10),
  });

  return z.toJSONSchema(
    hypothesisBoardSchema.extend({
      hypotheses: z.array(constrainedHypothesisSchema).min(2).max(5),
    }),
  ) as Record<string, unknown>;
}

function evidenceKey(ref: HypothesisEvidenceRef) {
  return `${ref.kind}:${ref.source.trim()}`;
}

export function parseHypothesisBoard(text: string): HypothesisBoard {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Hypothesis board response was not valid JSON.");
  }

  const result = hypothesisBoardSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `Hypothesis board did not satisfy the structured contract: ${result.error.message}`,
    );
  }

  return result.data;
}

export function assertHypothesisBoardGrounding(
  board: HypothesisBoard,
  context: {
    baselineCommand: string;
    preInspectedFiles: readonly string[];
  },
) {
  const errors: string[] = [];

  const availableEvidence = new Set<string>([
    `TEST:${context.baselineCommand.trim()}`,
    ...context.preInspectedFiles.map(
      (filePath) => `FILE:${filePath.trim()}`,
    ),
  ]);

  const hypothesisIds = new Set<string>();
  const semanticHypotheses = new Set<string>();

  for (const hypothesis of board.hypotheses) {
    if (hypothesisIds.has(hypothesis.id)) {
      errors.push(`Duplicate hypothesis id "${hypothesis.id}".`);
    }

    hypothesisIds.add(hypothesis.id);

    const semanticKey = [
      hypothesis.layer,
      hypothesis.hypothesis.trim().toLowerCase(),
    ].join(":");

    if (semanticHypotheses.has(semanticKey)) {
      errors.push(
        `Hypothesis "${hypothesis.id}" duplicates another causal hypothesis.`,
      );
    }

    semanticHypotheses.add(semanticKey);

    const supporting = new Set(
      hypothesis.supportingEvidenceRefs.map(evidenceKey),
    );

    for (const ref of [
      ...hypothesis.supportingEvidenceRefs,
      ...hypothesis.contradictingEvidenceRefs,
    ]) {
      const key = evidenceKey(ref);

      if (!availableEvidence.has(key)) {
        errors.push(
          `Hypothesis "${hypothesis.id}" references ${ref.kind} evidence "${ref.source}" that was not available from the trusted baseline or deterministic reconnaissance.`,
        );
      }
    }

    for (const ref of hypothesis.contradictingEvidenceRefs) {
      if (supporting.has(evidenceKey(ref))) {
        errors.push(
          `Hypothesis "${hypothesis.id}" uses the same evidence as both supporting and contradicting evidence: ${ref.kind} "${ref.source}".`,
        );
      }
    }
  }

  const competingIds = new Set<string>();

  for (const id of board.discriminationGoal.competingHypothesisIds) {
    if (competingIds.has(id)) {
      errors.push(
        `discriminationGoal contains duplicate hypothesis id "${id}".`,
      );
    }

    competingIds.add(id);

    if (!hypothesisIds.has(id)) {
      errors.push(
        `discriminationGoal references unknown hypothesis id "${id}".`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Hypothesis Board v4 is not grounded.",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}
