import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { classifyVerificationPath } from "../verification/integrity.js";

export type PatchInvestigationContext = {
  report: string;

  diagnosis: InvestigationDiagnosis;
};

export function buildPatchAgentContext(
  investigation: PatchInvestigationContext,
) {
  return {
    report: investigation.report,

    rootCause: investigation.diagnosis.rootCause,

    rootCauseAnalysis: investigation.diagnosis.rootCauseAnalysis,

    scopeAnalysis: investigation.diagnosis.scopeAnalysis,

    evidence: investigation.diagnosis.evidence,

    relevantFiles: investigation.diagnosis.relevantFiles,

    recommendedPatchTargets:
      investigation.diagnosis.recommendedPatchTargets.map((path) => ({
        path,

        verificationRole: classifyVerificationPath(path),
      })),

    patchTargetAnalysis: investigation.diagnosis.patchTargetAnalysis.map(
      (entry) => ({
        ...entry,

        verificationRole: classifyVerificationPath(entry.path),
      }),
    ),

    patchIntents: investigation.diagnosis.patchIntents.map((intent) => ({
      ...intent,

      verificationRole: classifyVerificationPath(intent.path),
    })),

    confidence: investigation.diagnosis.confidence,
  };
}
