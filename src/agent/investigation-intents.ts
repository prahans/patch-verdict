import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { classifyVerificationPath } from "../verification/integrity.js";
import { assertRepairKindCompatibleWithCause } from "./root-cause-contract.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function createEvidenceKey(kind: string, source: string) {
  return `${kind}:${source.trim()}`;
}

export function assertPatchIntentContract(
  diagnosis: InvestigationDiagnosis,
) {
  const errors: string[] = [];

  const recommendedTargets = new Set(
    diagnosis.recommendedPatchTargets.map(normalizePath),
  );

  const recommendedAnalysisPaths = new Set(
    diagnosis.patchTargetAnalysis
      .filter((entry) => entry.decision === "RECOMMEND")
      .map((entry) => normalizePath(entry.path)),
  );

  const availableEvidence = new Set(
    diagnosis.evidence.map((evidence) =>
      createEvidenceKey(evidence.kind, evidence.source),
    ),
  );

  const intentIds = new Set<string>();
  const targetsWithIntents = new Set<string>();

  for (const intent of diagnosis.patchIntents) {
    const path = normalizePath(intent.path);

    if (intentIds.has(intent.id)) {
      errors.push(`Duplicate patch intent id "${intent.id}".`);
    }

    intentIds.add(intent.id);

    if (!recommendedTargets.has(path)) {
      errors.push(
        `Patch intent "${intent.id}" targets "${intent.path}", which is not present in recommendedPatchTargets.`,
      );
    }

    if (!recommendedAnalysisPaths.has(path)) {
      errors.push(
        `Patch intent "${intent.id}" targets "${intent.path}", which is not marked RECOMMEND in patchTargetAnalysis.`,
      );
    }

    if (
      intent.repairKind === "ROOT_CAUSE_FIX" &&
      diagnosis.rootCauseAnalysis.alternatives.some(
        (alternative) => alternative.status === "UNRESOLVED",
      )
    ) {
      errors.push(
        `Patch intent "${intent.id}" cannot be ROOT_CAUSE_FIX while a competing cause remains UNRESOLVED.`,
      );
    }

    try {
      assertRepairKindCompatibleWithCause({
        repairKind: intent.repairKind,
        causeLayer: diagnosis.rootCauseAnalysis.primaryCause.layer,
        targetRole: classifyVerificationPath(intent.path),
      });
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `Patch intent "${intent.id}" has incompatible repair classification: ${error.message}`
          : `Patch intent "${intent.id}" has an incompatible repair classification.`,
      );
    }

    for (const evidenceRef of intent.evidenceRefs) {
      const evidenceKey = createEvidenceKey(
        evidenceRef.kind,
        evidenceRef.source,
      );

      if (!availableEvidence.has(evidenceKey)) {
        errors.push(
          `Patch intent "${intent.id}" references ${evidenceRef.kind} evidence "${evidenceRef.source}" that does not exist in diagnosis.evidence.`,
        );
      }
    }

    targetsWithIntents.add(path);
  }

  for (const target of recommendedTargets) {
    if (!targetsWithIntents.has(target)) {
      errors.push(`Recommended patch target "${target}" has no patch intent.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Investigation patch-intent contract is inconsistent.",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}
