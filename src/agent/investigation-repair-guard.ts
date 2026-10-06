import type { InvestigationDiagnosis } from "./investigation-contract.js";

function semanticSnapshot(diagnosis: InvestigationDiagnosis) {
  return {
    rootCause: diagnosis.rootCause,

    primaryCause: {
      layer: diagnosis.rootCauseAnalysis.primaryCause.layer,
      hypothesis: diagnosis.rootCauseAnalysis.primaryCause.hypothesis,
    },

    alternatives: diagnosis.rootCauseAnalysis.alternatives.map(
      (alternative) => ({
        layer: alternative.layer,
        hypothesis: alternative.hypothesis,
        status: alternative.status,
      }),
    ),

    scope: diagnosis.scopeAnalysis.scope,

    evidence: diagnosis.evidence,

    relevantFiles: diagnosis.relevantFiles,

    recommendedPatchTargets: diagnosis.recommendedPatchTargets,

    patchTargetDecisions: diagnosis.patchTargetAnalysis.map((entry) => ({
      path: entry.path,
      decision: entry.decision,
    })),

    patchIntents: diagnosis.patchIntents.map((intent) => ({
      id: intent.id,
      path: intent.path,
      objective: intent.objective,
      repairKind: intent.repairKind,
    })),

    confidence: diagnosis.confidence,
  };
}

export function assertNoSemanticDriftDuringContractRepair(
  before: InvestigationDiagnosis,
  after: InvestigationDiagnosis,
) {
  const beforeSnapshot = semanticSnapshot(before);
  const afterSnapshot = semanticSnapshot(after);

  if (JSON.stringify(beforeSnapshot) !== JSON.stringify(afterSnapshot)) {
    throw new Error(
      [
        "No-tool contract repair attempted to change investigation semantics.",
        "A contract repair may correct evidenceRefs or explanatory reason/report text, but it may not change the root-cause hypothesis, cause layer, alternatives, scope, evidence ledger, target decisions, patch intent path/objective/repairKind, or confidence.",
        "The investigation must gather more evidence or fail closed instead of changing the diagnosis merely to satisfy the validator.",
      ].join("\n"),
    );
  }
}
