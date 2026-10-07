import type { InvestigationDiagnosis } from "./investigation-contract.js";

export type PatchTargetAnalysisContext = {
  inspectedFiles: readonly string[];
};

function createEvidenceKey(kind: string, source: string) {
  return `${kind}:${source.trim()}`;
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function assertPatchTargetAnalysis(
  diagnosis: InvestigationDiagnosis,
  context: PatchTargetAnalysisContext,
) {
  const errors: string[] = [];

  const relevantFiles = new Set(diagnosis.relevantFiles.map(normalizePath));

  const availableEvidence = new Set(
    diagnosis.evidence.map((evidence) =>
      createEvidenceKey(evidence.kind, evidence.source),
    ),
  );

  const recommendedTargets =
    diagnosis.recommendedPatchTargets.map(normalizePath);

  const recommendedTargetSet = new Set(recommendedTargets);

  if (recommendedTargetSet.size !== recommendedTargets.length) {
    errors.push("recommendedPatchTargets contains duplicate paths.");
  }

  const analysisByPath = new Map<
    string,
    (typeof diagnosis.patchTargetAnalysis)[number]
  >();

  for (const entry of diagnosis.patchTargetAnalysis) {
    const path = normalizePath(entry.path);

    if (analysisByPath.has(path)) {
      errors.push(
        `Patch-target analysis contains duplicate path "${entry.path}".`,
      );

      continue;
    }

    analysisByPath.set(path, entry);

    if (!relevantFiles.has(path)) {
      errors.push(
        `Patch-target analysis path "${entry.path}" is not present in relevantFiles.`,
      );
    }

    let referencesOwnFileEvidence = false;

    for (const evidenceRef of entry.evidenceRefs) {
      const evidenceKey = createEvidenceKey(
        evidenceRef.kind,
        evidenceRef.source,
      );

      if (!availableEvidence.has(evidenceKey)) {
        errors.push(
          `Patch-target analysis for "${entry.path}" references ${evidenceRef.kind} evidence "${evidenceRef.source}" that does not exist in diagnosis.evidence.`,
        );
      }

      if (
        evidenceRef.kind === "FILE" &&
        normalizePath(evidenceRef.source) === path
      ) {
        referencesOwnFileEvidence = true;
      }
    }

    if (!referencesOwnFileEvidence) {
      errors.push(
        `Patch-target analysis for "${entry.path}" must reference FILE evidence for that same path.`,
      );
    }
  }

  /*
   * Every recommended target must
   * explicitly be marked RECOMMEND.
   */
  for (const target of recommendedTargetSet) {
    const analysis = analysisByPath.get(target);

    if (!analysis) {
      errors.push(
        `Recommended patch target "${target}" has no patch-target analysis.`,
      );

      continue;
    }

    if (analysis.decision !== "RECOMMEND") {
      errors.push(
        `Recommended patch target "${target}" is not marked RECOMMEND in patch-target analysis.`,
      );
    }
  }

  /*
   * The reverse must also hold.
   * The model cannot secretly RECOMMEND
   * something absent from the authoritative
   * recommended target list.
   */
  for (const entry of diagnosis.patchTargetAnalysis) {
    const path = normalizePath(entry.path);

    if (entry.decision === "RECOMMEND" && !recommendedTargetSet.has(path)) {
      errors.push(
        `Patch-target analysis marks "${entry.path}" RECOMMEND but it is not present in recommendedPatchTargets.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Investigation patch-target analysis is inconsistent.",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}
