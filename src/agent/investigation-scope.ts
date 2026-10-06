import type { InvestigationDiagnosis } from "./investigation-contract.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function createEvidenceKey(kind: string, source: string) {
  return `${kind}:${source.trim()}`;
}

export function assertFailureScopeAnalysis(
  diagnosis: InvestigationDiagnosis,
) {
  const errors: string[] = [];

  const availableEvidence = new Set(
    diagnosis.evidence.map((evidence) =>
      createEvidenceKey(evidence.kind, evidence.source),
    ),
  );

  const scopeEvidenceKeys = new Set<string>();

  let hasFileEvidence = false;

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
    }
  }

  if (!hasFileEvidence) {
    errors.push(
      "Failure scope must reference at least one FILE evidence observation.",
    );
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
