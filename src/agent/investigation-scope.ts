import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { classifyVerificationPath } from "../verification/integrity.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function createEvidenceKey(kind: string, source: string) {
  return `${kind}:${source.trim()}`;
}

export type FailureScopeAnalysisContext = {
  inspectedFiles: readonly string[];
};

export function assertFailureScopeAnalysis(
  diagnosis: InvestigationDiagnosis,
  context: FailureScopeAnalysisContext,
) {
  const errors: string[] = [];

  const availableEvidence = new Set(
    diagnosis.evidence.map((evidence) =>
      createEvidenceKey(evidence.kind, evidence.source),
    ),
  );

  const scopeEvidenceKeys = new Set<string>();

  let hasFileEvidence = false;

  let hasTestEvidence = false;

  const scopeFileEvidencePaths = new Set<string>();

  for (const evidenceRef of diagnosis.scopeAnalysis.evidenceRefs) {
    const key = createEvidenceKey(evidenceRef.kind, evidenceRef.source);

    if (scopeEvidenceKeys.has(key)) {
      errors.push(
        `Failure scope contains duplicate evidence reference ${evidenceRef.kind} "${evidenceRef.source}".`,
      );
    }

    scopeEvidenceKeys.add(key);

    if (!availableEvidence.has(key)) {
      errors.push(
        `Failure scope references ${evidenceRef.kind} evidence "${evidenceRef.source}" that does not exist in diagnosis.evidence.`,
      );
    }

    if (evidenceRef.kind === "FILE") {
      hasFileEvidence = true;

      scopeFileEvidencePaths.add(normalizePath(evidenceRef.source));
    }

    if (evidenceRef.kind === "TEST") {
      hasTestEvidence = true;
    }
  }

  if (!hasFileEvidence) {
    errors.push(
      "Failure scope must reference at least one FILE evidence observation.",
    );
  }

  if (diagnosis.scopeAnalysis.scope === "SHARED") {
    const hasNonTestFileEvidence = [...scopeFileEvidencePaths].some(
      (path) => classifyVerificationPath(path) !== "TEST_FILE",
    );

    if (!hasNonTestFileEvidence) {
      errors.push(
        "Failure scope SHARED must reference FILE evidence outside a direct test file.",
      );
    }

    if (!hasTestEvidence) {
      errors.push(
        "Failure scope SHARED must reference TEST evidence so the shared-scope claim remains connected to observed execution behavior.",
      );
    }
  }

  if (diagnosis.scopeAnalysis.scope === "LOCAL") {
    const inspectedSharedVerificationCandidates = [
      ...new Set(
        context.inspectedFiles
          .map(normalizePath)
          .filter((path) => {
            const role = classifyVerificationPath(path);

            return (
              role === "TEST_INFRASTRUCTURE" ||
              role === "TEST_SUPPORT"
            );
          }),
      ),
    ];

    const missingSharedCandidateEvidence =
      inspectedSharedVerificationCandidates.filter(
        (path) => !scopeFileEvidencePaths.has(path),
      );

    if (missingSharedCandidateEvidence.length > 0) {
      errors.push(
        [
          "Failure scope LOCAL was selected after shared verification support was inspected.",
          "The local-scope analysis must explicitly cite FILE evidence for every inspected TEST_INFRASTRUCTURE or TEST_SUPPORT candidate so shared scope is not dismissed implicitly.",
          `Missing scope evidence for: ${missingSharedCandidateEvidence.join(", ")}.`,
        ].join(" "),
      );
    }
  }

  if (
    diagnosis.scopeAnalysis.scope === "UNKNOWN" &&
    diagnosis.confidence === "HIGH"
  ) {
    errors.push(
      "Failure scope UNKNOWN cannot be paired with HIGH diagnosis confidence.",
    );
  }

  /*
   * For LOCAL or SHARED scope claims, every recommended target must be
   * explicitly connected to at least one piece of evidence used to justify
   * that scope. This prevents target choice from drifting away from the
   * investigator's own scope reasoning.
   */
  if (diagnosis.scopeAnalysis.scope !== "UNKNOWN") {
    for (const entry of diagnosis.patchTargetAnalysis) {
      if (entry.decision !== "RECOMMEND") {
        continue;
      }

      const targetEvidenceKeys = new Set(
        entry.evidenceRefs.map((evidenceRef) =>
          createEvidenceKey(evidenceRef.kind, evidenceRef.source),
        ),
      );

      const sharesScopeEvidence = [...scopeEvidenceKeys].some((key) =>
        targetEvidenceKeys.has(key),
      );

      if (!sharesScopeEvidence) {
        errors.push(
          `Recommended target "${normalizePath(entry.path)}" is not linked to any evidence used by the ${diagnosis.scopeAnalysis.scope} failure-scope analysis.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Investigation failure-scope analysis is inconsistent.",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}
