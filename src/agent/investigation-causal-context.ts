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

  const primaryCauseHasRuntimeEvidence =
    diagnosis.rootCauseAnalysis.primaryCause.evidenceRefs.some(
      (ref) => ref.kind === "TEST",
    );

  if (!primaryCauseHasRuntimeEvidence) {
    throw new Error(
      [
        "Strong test-stack causal claim is disconnected from observed execution behavior.",
        `A ${causeLayer} cause with ${diagnosis.confidence} confidence${hasRootCauseFix ? " and ROOT_CAUSE_FIX intent" : ""} must cite TEST evidence in primaryCause.evidenceRefs.`,
      ].join("\n"),
    );
  }

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

  const causalRefs = new Set<string>();

  const addRefs = (
    refs: readonly {
      kind: "FILE" | "TEST" | "SEARCH";
      source: string;
    }[],
  ) => {
    for (const ref of refs) {
      if (ref.kind === "FILE") {
        causalRefs.add(normalizePath(ref.source));
      }
    }
  };

  addRefs(diagnosis.rootCauseAnalysis.primaryCause.evidenceRefs);

  for (const alternative of diagnosis.rootCauseAnalysis.alternatives) {
    addRefs(alternative.evidenceRefs);
  }

  const representedCauseLayers = new Set([
    diagnosis.rootCauseAnalysis.primaryCause.layer,
    ...diagnosis.rootCauseAnalysis.alternatives.map(
      (alternative) => alternative.layer,
    ),
  ]);

  const requiredCompetingLayers: Array<{
    layer: "CONFIGURATION" | "DEPENDENCY_RUNTIME" | "TEST_INFRASTRUCTURE";
    candidates: string[];
  }> = [
    {
      layer: "CONFIGURATION",
      candidates: candidates.runnerConfigs,
    },
    {
      layer: "DEPENDENCY_RUNTIME",
      candidates: candidates.packageManifests,
    },
    {
      layer: "TEST_INFRASTRUCTURE",
      candidates: candidates.testSetups,
    },
  ];

  for (const requirement of requiredCompetingLayers) {
    const hasInspectedCandidate = requirement.candidates.some((path) =>
      inspected.has(path),
    );

    if (
      hasInspectedCandidate &&
      !representedCauseLayers.has(requirement.layer)
    ) {
      throw new Error(
        [
          "Root-cause analysis did not compare a discovered competing cause layer.",
          `A strong ${causeLayer} causal claim must account for ${requirement.layer} because relevant repository context was discovered and inspected: ${requirement.candidates.join(", ")}.`,
          "Represent that layer as the primary cause or as a REJECTED/UNRESOLVED alternative with evidence.",
        ].join("\n"),
      );
    }
  }

  const layerEvidenceRefs = new Map<
    string,
    Set<string>
  >();

  const registerLayerRefs = (
    layer: string,
    refs: readonly {
      kind: "FILE" | "TEST" | "SEARCH";
      source: string;
    }[],
  ) => {
    const existing = layerEvidenceRefs.get(layer) ?? new Set<string>();

    for (const ref of refs) {
      if (ref.kind === "FILE") {
        existing.add(normalizePath(ref.source));
      }
    }

    layerEvidenceRefs.set(layer, existing);
  };

  registerLayerRefs(
    diagnosis.rootCauseAnalysis.primaryCause.layer,
    diagnosis.rootCauseAnalysis.primaryCause.evidenceRefs,
  );

  for (const alternative of diagnosis.rootCauseAnalysis.alternatives) {
    registerLayerRefs(alternative.layer, alternative.evidenceRefs);
  }

  for (const requirement of requiredCompetingLayers) {
    const inspectedCandidates = requirement.candidates.filter((path) =>
      inspected.has(path),
    );

    if (inspectedCandidates.length === 0) {
      continue;
    }

    const refsForLayer =
      layerEvidenceRefs.get(requirement.layer) ?? new Set<string>();

    if (!inspectedCandidates.some((path) => refsForLayer.has(path))) {
      throw new Error(
        [
          `Cause layer ${requirement.layer} is represented without evidence from its discovered repository context.`,
          `Expected one of: ${inspectedCandidates.join(", ")}.`,
        ].join("\n"),
      );
    }
  }

  const inspectedEnvironmentFiles = [
    ...candidates.packageManifests,
    ...candidates.runnerConfigs,
    ...candidates.testSetups,
  ].filter((path) => inspected.has(path));

  const ignoredEnvironmentFiles = inspectedEnvironmentFiles.filter(
    (path) => !causalRefs.has(path),
  );

  if (ignoredEnvironmentFiles.length > 0) {
    throw new Error(
      [
        "Root-cause analysis inspected causal environment context but did not account for it.",
        `Missing primary/alternative cause evidence references for: ${ignoredEnvironmentFiles.join(", ")}.`,
        "Environment context used to distinguish test infrastructure, configuration, and dependency/runtime causes must participate in the causal analysis.",
      ].join("\n"),
    );
  }
}
