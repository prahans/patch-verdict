import type { InvestigationDiagnosis } from "./investigation-contract.js";

export type InvestigationProvenance = {
  inspectedFiles: readonly string[];
  executedTests: readonly string[];
  searchQueries: readonly string[];
};

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

export function assertInvestigationProvenance(
  diagnosis: InvestigationDiagnosis,
  provenance: InvestigationProvenance,
) {
  const inspectedFiles = new Set(provenance.inspectedFiles.map(normalizePath));

  const executedTests = new Set(
    provenance.executedTests.map((value) => value.trim()),
  );

  const searchQueries = new Set(
    provenance.searchQueries.map((value) => value.trim()),
  );

  const relevantFiles = new Set(diagnosis.relevantFiles.map(normalizePath));

  const errors: string[] = [];

  if (inspectedFiles.size === 0) {
    errors.push("No repository file was successfully inspected.");
  }

  for (const file of diagnosis.relevantFiles) {
    const normalized = normalizePath(file);

    if (!inspectedFiles.has(normalized)) {
      errors.push(`Relevant file "${file}" was not inspected with read_file.`);
    }
  }

  for (const target of diagnosis.recommendedPatchTargets) {
    const normalized = normalizePath(target);

    if (!inspectedFiles.has(normalized)) {
      errors.push(
        `Recommended patch target "${target}" was not inspected with read_file.`,
      );
    }

    if (!relevantFiles.has(normalized)) {
      errors.push(
        `Recommended patch target "${target}" is not present in relevantFiles.`,
      );
    }
  }

  for (const evidence of diagnosis.evidence) {
    if (
      evidence.kind === "FILE" &&
      !inspectedFiles.has(normalizePath(evidence.source))
    ) {
      errors.push(
        `FILE evidence source "${evidence.source}" was not inspected.`,
      );
    }

    if (
      evidence.kind === "TEST" &&
      !executedTests.has(evidence.source.trim())
    ) {
      errors.push(
        `TEST evidence source "${evidence.source}" was not executed.`,
      );
    }

    if (
      evidence.kind === "SEARCH" &&
      !searchQueries.has(evidence.source.trim())
    ) {
      errors.push(
        `SEARCH evidence source "${evidence.source}" was not executed.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        "Investigation diagnosis is not grounded in observed tool evidence.",
        ...errors.map((error) => `- ${error}`),
      ].join("\n"),
    );
  }
}
