import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { classifyVerificationPath } from "../verification/integrity.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function assertPatchTargetAnalysis(diagnosis: InvestigationDiagnosis) {
  const errors: string[] = [];

  const relevantFiles = new Set(diagnosis.relevantFiles.map(normalizePath));

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
   * something that is absent from the
   * authoritative target list.
   */
  for (const entry of diagnosis.patchTargetAnalysis) {
    const path = normalizePath(entry.path);

    if (entry.decision === "RECOMMEND" && !recommendedTargetSet.has(path)) {
      errors.push(
        `Patch-target analysis marks "${entry.path}" RECOMMEND but it is not present in recommendedPatchTargets.`,
      );
    }
  }

  /*
   * Important trust boundary:
   *
   * If the model recommends changing a
   * direct test while it has identified
   * relevant test infrastructure, it must
   * explicitly compare that infrastructure
   * before choosing the test file.
   *
   * PatchVerdict does NOT force the
   * infrastructure to win.
   */
  const recommendsDirectTest = [...recommendedTargetSet].some(
    (path) => classifyVerificationPath(path) === "TEST_FILE",
  );

  const relevantTestInfrastructure = diagnosis.relevantFiles.filter(
    (path) => classifyVerificationPath(path) === "TEST_INFRASTRUCTURE",
  );

  if (recommendsDirectTest && relevantTestInfrastructure.length > 0) {
    const analyzedInfrastructure = relevantTestInfrastructure.some((path) =>
      analysisByPath.has(normalizePath(path)),
    );

    if (!analyzedInfrastructure) {
      errors.push(
        [
          "A direct TEST_FILE is recommended while relevant TEST_INFRASTRUCTURE was identified.",
          "The investigation must explicitly analyze at least one relevant test-infrastructure candidate before recommending the test file.",
        ].join(" "),
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
