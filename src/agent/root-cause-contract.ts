import { z } from "zod";

export const causeLayerSchema = z.enum([
  "APPLICATION_CODE",
  "CONFIGURATION",
  "DEPENDENCY_RUNTIME",
  "TEST_INFRASTRUCTURE",
  "TEST_SUPPORT",
  "TEST_FILE",
  "UNKNOWN",
]);

export const repairKindSchema = z.enum([
  "ROOT_CAUSE_FIX",
  "WORKAROUND",
  "MITIGATION",
]);

const evidenceRefSchema = z
  .object({
    kind: z.enum(["FILE", "TEST", "SEARCH", "EXPERIMENT"]),
    source: z.string().trim().min(1).max(500),
  })
  .strict();

const causeHypothesisSchema = z
  .object({
    layer: causeLayerSchema,
    hypothesis: z.string().trim().min(10).max(3000),
    evidenceRefs: z.array(evidenceRefSchema).min(1).max(10),
  })
  .strict();

const alternativeCauseSchema = z
  .object({
    layer: causeLayerSchema,
    hypothesis: z.string().trim().min(10).max(3000),
    status: z.enum(["REJECTED", "UNRESOLVED"]),
    reason: z.string().trim().min(10).max(3000),
    evidenceRefs: z.array(evidenceRefSchema).min(1).max(10),
  })
  .strict();

export const rootCauseAnalysisSchema = z
  .object({
    failureMechanism: z.string().trim().min(10).max(3000),
    primaryCause: causeHypothesisSchema,
    alternatives: z.array(alternativeCauseSchema).max(6),
  })
  .strict();

export type CauseLayer = z.infer<typeof causeLayerSchema>;
export type RepairKind = z.infer<typeof repairKindSchema>;
export type RootCauseAnalysis = z.infer<typeof rootCauseAnalysisSchema>;

type Evidence = {
  kind: "FILE" | "TEST" | "SEARCH" | "EXPERIMENT";
  source: string;
};

type VerificationRole =
  | "TEST_FILE"
  | "TEST_SUPPORT"
  | "TEST_INFRASTRUCTURE"
  | "OTHER";

function evidenceKey(kind: string, source: string) {
  return `${kind}:${source.trim()}`;
}

export function assertRootCauseAnalysisGrounding(
  analysis: RootCauseAnalysis,
  evidence: readonly Evidence[],
  confidence: "LOW" | "MEDIUM" | "HIGH",
) {
  const errors: string[] = [];

  const availableEvidence = new Set(
    evidence.map((entry) => evidenceKey(entry.kind, entry.source)),
  );

  const assertRefsExist = (
    label: string,
    refs: RootCauseAnalysis["primaryCause"]["evidenceRefs"],
  ) => {
    for (const ref of refs) {
      if (!availableEvidence.has(evidenceKey(ref.kind, ref.source))) {
        errors.push(
          `${label} references ${ref.kind} evidence "${ref.source}" that does not exist in investigation evidence.`,
        );
      }
    }
  };

  assertRefsExist("Primary cause", analysis.primaryCause.evidenceRefs);

  for (const alternative of analysis.alternatives) {
    assertRefsExist(
      `Alternative cause "${alternative.hypothesis}"`,
      alternative.evidenceRefs,
    );

    if (
      alternative.layer === "DEPENDENCY_RUNTIME" &&
      !alternative.evidenceRefs.some(
        (ref) => ref.kind === "TEST" || ref.kind === "EXPERIMENT",
      )
    ) {
      errors.push(
        `Alternative DEPENDENCY_RUNTIME cause "${alternative.hypothesis}" must cite TEST or EXPERIMENT evidence for the observed runtime behavior.`,
      );
    }

    if (
      alternative.layer === analysis.primaryCause.layer &&
      alternative.hypothesis.trim().toLowerCase() ===
        analysis.primaryCause.hypothesis.trim().toLowerCase()
    ) {
      errors.push(
        "An alternative cause duplicates the primary cause hypothesis.",
      );
    }
  }

  if (analysis.primaryCause.layer === "UNKNOWN" && confidence === "HIGH") {
    errors.push(
      "Primary cause layer UNKNOWN cannot be paired with HIGH diagnosis confidence.",
    );
  }

  if (
    confidence === "HIGH" &&
    analysis.alternatives.some(
      (alternative) => alternative.status === "UNRESOLVED",
    )
  ) {
    errors.push(
      "HIGH diagnosis confidence is not allowed while a competing cause remains UNRESOLVED.",
    );
  }

  if (analysis.primaryCause.layer === "DEPENDENCY_RUNTIME") {
    const hasRuntimeEvidence = analysis.primaryCause.evidenceRefs.some(
      (ref) => ref.kind === "TEST" || ref.kind === "EXPERIMENT",
    );

    if (!hasRuntimeEvidence) {
      errors.push(
        "Primary cause layer DEPENDENCY_RUNTIME must cite TEST or EXPERIMENT evidence for the observed runtime behavior.",
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Root Cause Contract v3 is inconsistent.",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}

export function assertRepairKindCompatibleWithCause(input: {
  repairKind: RepairKind;
  causeLayer: CauseLayer;
  targetRole: VerificationRole;
}) {
  if (
    input.repairKind === "ROOT_CAUSE_FIX" &&
    input.causeLayer === "UNKNOWN"
  ) {
    throw new Error(
      "A patch cannot be classified as ROOT_CAUSE_FIX while the primary cause layer is UNKNOWN.",
    );
  }

  if (input.repairKind !== "ROOT_CAUSE_FIX") {
    return;
  }

  if (
    input.causeLayer === "DEPENDENCY_RUNTIME" &&
    (input.targetRole === "TEST_FILE" ||
      input.targetRole === "TEST_SUPPORT" ||
      input.targetRole === "TEST_INFRASTRUCTURE")
  ) {
    throw new Error(
      `A ${input.targetRole} patch cannot be classified as ROOT_CAUSE_FIX when the identified cause is DEPENDENCY_RUNTIME. Classify it as WORKAROUND or MITIGATION unless the dependency/runtime cause itself is changed.`,
    );
  }

  const requiredRoleByCauseLayer: Partial<
    Record<CauseLayer, VerificationRole>
  > = {
    APPLICATION_CODE: "OTHER",
    TEST_FILE: "TEST_FILE",
    TEST_SUPPORT: "TEST_SUPPORT",
    TEST_INFRASTRUCTURE: "TEST_INFRASTRUCTURE",
  };

  const requiredRole = requiredRoleByCauseLayer[input.causeLayer];

  if (requiredRole && input.targetRole !== requiredRole) {
    throw new Error(
      `A patch targeting ${input.targetRole} cannot be classified as ROOT_CAUSE_FIX when the identified cause layer is ${input.causeLayer}; expected target role ${requiredRole}.`,
    );
  }
}
