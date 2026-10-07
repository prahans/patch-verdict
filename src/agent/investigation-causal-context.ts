import type { InvestigationDiagnosis } from "./investigation-contract.js";

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function isPackageManifest(path: string) {
  return normalizePath(path) === "package.json";
}

function isRunnerConfig(path: string) {
  const normalized = normalizePath(path);

  return /(^|\/)(?:vite|vitest|jest|playwright|cypress)\.config\.[^/]+$/i.test(
    normalized,
  );
}

function isTestSetup(path: string) {
  const normalized = normalizePath(path);

  return (
    /(^|\/)(?:vitest|jest)\.setup\.[^/]+$/i.test(normalized) ||
    /(^|\/)setupTests\.[^/]+$/i.test(normalized)
  );
}

export type CausalContextCandidates = {
  packageManifests: string[];
  runnerConfigs: string[];
  testSetups: string[];
};

export function findCausalContextCandidates(
  discoveredFiles: readonly string[],
): CausalContextCandidates {
  const normalized = [...new Set(discoveredFiles.map(normalizePath))];

  return {
    packageManifests: normalized.filter(isPackageManifest),
    runnerConfigs: normalized.filter(isRunnerConfig),
    testSetups: normalized.filter(isTestSetup),
  };
}

export function findUninspectedCausalContext(
  discoveredFiles: readonly string[],
  inspectedFiles: readonly string[],
): string[] {
  const candidates = findCausalContextCandidates(discoveredFiles);

  const inspected = new Set(inspectedFiles.map(normalizePath));

  return [
    ...candidates.packageManifests,
    ...candidates.runnerConfigs,
    ...candidates.testSetups,
  ].filter((path) => !inspected.has(path));
}

export function assertCausalContextCoverage(
  diagnosis: InvestigationDiagnosis,
  context: {
    discoveredFiles: readonly string[];
    inspectedFiles: readonly string[];
  },
) {
  const causeLayer = diagnosis.rootCauseAnalysis.primaryCause.layer;

  const hasRootCauseFix = diagnosis.patchIntents.some(
    (intent) => intent.repairKind === "ROOT_CAUSE_FIX",
  );

  const requiresStrongCausalContext =
    diagnosis.confidence === "HIGH" || hasRootCauseFix;

  if (!requiresStrongCausalContext) {
    return;
  }

  if (
    causeLayer !== "TEST_INFRASTRUCTURE" &&
    causeLayer !== "CONFIGURATION" &&
    causeLayer !== "DEPENDENCY_RUNTIME"
  ) {
    return;
  }

  const candidates = findCausalContextCandidates(context.discoveredFiles);

  const inspected = new Set(context.inspectedFiles.map(normalizePath));

  const required: string[] = [];

  if (candidates.runnerConfigs.length > 0) {
    const inspectedRunnerConfig = candidates.runnerConfigs.find((path) =>
      inspected.has(path),
    );

    if (!inspectedRunnerConfig) {
      required.push(
        `test-runner configuration (${candidates.runnerConfigs.join(", ")})`,
      );
    }
  }

  if (
    (causeLayer === "TEST_INFRASTRUCTURE" ||
      causeLayer === "DEPENDENCY_RUNTIME") &&
    candidates.packageManifests.length > 0
  ) {
    const inspectedManifest = candidates.packageManifests.find((path) =>
      inspected.has(path),
    );

    if (!inspectedManifest) {
      required.push(
        `package manifest (${candidates.packageManifests.join(", ")})`,
      );
    }
  }

  if (required.length > 0) {
    throw new Error(
      [
        "Root-cause classification lacks required causal environment context.",
        `A ${causeLayer} cause with ${diagnosis.confidence} confidence${hasRootCauseFix ? " and ROOT_CAUSE_FIX intent" : ""} cannot be finalized before inspecting: ${required.join("; ")}.`,
        "Inspect the discovered environment context, or downgrade the causal claim and classify the repair as WORKAROUND/MITIGATION when uncertainty remains.",
      ].join("\n"),
    );
  }

  // For the hackathon flow, environment inspection is the causal safety gate.
  // Once the relevant config/manifest context has been inspected, do not force
  // the model to manufacture explicit competing-layer alternatives or duplicate
  // every inspected environment file across causal evidence references.
  return;

}
