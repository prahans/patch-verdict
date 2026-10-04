import "server-only";

import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type {
  CommandEvidence,
  MissionEvent,
  MissionResult,
  MissionState,
  MissionViewModel,
} from "./mission-types";

type JsonObject = Record<string, unknown>;
type ProofMetadata = {
  id: string;
  issue: string;

  source?: {
    repositoryUrl: string;
    baseCommit: string;
  };

  reproduction: {
    label: string;
    command: string;
  };

  fullSuite: {
    label: string;
    command: string;
  };
  status: MissionResult["status"];
  verdict: MissionResult["verdict"];
  checks?: MissionResult["checks"];
  reproductionClassification?: {
    reproduced: boolean;
    checks: {
      exitCodeMatched: boolean;
      missingRequiredOutput: string[];
      presentForbiddenOutput: string[];
    };
  };
  patch?: MissionResult["patch"];
  iterations?: number;
  error?: string;
  available: {
    report: boolean;
    diff: boolean;
    baseline: boolean;
    postPatch: boolean;
    fullSuite: boolean;
  };
};

const missionStates = new Set<MissionState>([
  "PREPARING",
  "BASELINE",
  "INVESTIGATING",
  "PATCHING",
  "VERIFYING",
  "VERDICT",
  "COMPLETED",
  "FAILED",
]);

function invalid(label: string, expectation: string): never {
  throw new Error(`Invalid ${label}: expected ${expectation}.`);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(label, "an object");
  }
  return value as JsonObject;
}

function string(value: unknown, label: string, nonempty = false): string {
  if (typeof value !== "string" || (nonempty && !value.trim())) {
    return invalid(label, nonempty ? "a nonempty string" : "a string");
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  return typeof value === "boolean" ? value : invalid(label, "a boolean");
}

function number(value: unknown, label: string, integer = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value))
  ) {
    return invalid(label, integer ? "a finite integer" : "a finite number");
  }
  return value;
}

function parseJson(contents: string, filename: string): unknown {
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(
      `Invalid JSON in ${filename}. Fix or regenerate this proof artifact.`,
    );
  }
}

function parseProof(value: unknown, missionId: string): ProofMetadata {
  const proof = object(value, "proof.json");
  if (proof.version !== 2) {
    invalid("proof.json version", "version 2");
  }
  const mission = object(proof.mission, "proof.json mission");

  const source =
    mission.source == null
      ? undefined
      : object(mission.source, "proof.json mission.source");

  const reproduction = object(
    mission.reproduction,
    "proof.json mission.reproduction",
  );
  const fullSuite = object(mission.fullSuite, "proof.json mission.fullSuite");
  const id = string(mission.id, "proof.json mission.id", true);
  if (id !== missionId) {
    throw new Error(
      `Invalid proof.json mission.id: expected "${missionId}" to match its bundle directory.`,
    );
  }
  if (proof.status !== "COMPLETED" && proof.status !== "FAILED") {
    invalid("proof.json status", "COMPLETED or FAILED");
  }
  if (
    proof.verdict !== "VERIFIED" &&
    proof.verdict !== "FAILED" &&
    proof.verdict !== null
  ) {
    invalid("proof.json verdict", "VERIFIED, FAILED, or null");
  }
  const artifacts =
    proof.artifacts == null
      ? undefined
      : object(proof.artifacts, "proof.json artifacts");
  const evidenceArtifacts =
    artifacts?.evidence == null
      ? undefined
      : object(artifacts.evidence, "proof.json artifacts.evidence");
  // Explicit null means this run produced no artifact, even if an older file remains.
  // Older manifests without these fields may still use the fixed artifact filenames.
  const hasArtifacts = proof.artifacts !== null;
  const hasEvidence = hasArtifacts && artifacts?.evidence !== null;
  const metadata: ProofMetadata = {
    id,
    issue: string(mission.issue, "proof.json mission.issue", true),
    reproduction: {
      label: string(
        reproduction.label,
        "proof.json mission.reproduction.label",
        true,
      ),
      command: string(
        reproduction.command,
        "proof.json mission.reproduction.command",
        true,
      ),
    },
    fullSuite: {
      label: string(
        fullSuite.label,
        "proof.json mission.fullSuite.label",
        true,
      ),
      command: string(
        fullSuite.command,
        "proof.json mission.fullSuite.command",
        true,
      ),
    },
    status: proof.status,
    verdict: proof.verdict,
    available: {
      report:
        hasArtifacts &&
        proof.investigation !== null &&
        artifacts?.investigation !== null,
      diff: hasArtifacts && proof.patch != null && artifacts?.patch !== null,
      baseline: hasEvidence && evidenceArtifacts?.baseline !== null,
      postPatch: hasEvidence && evidenceArtifacts?.postPatch !== null,
      fullSuite: hasEvidence && evidenceArtifacts?.fullSuite !== null,
    },
  };

  if (source) {
    const repositoryUrl = string(
      source.repositoryUrl,
      "proof.json mission.source.repositoryUrl",
      true,
    );

    const baseCommit = string(
      source.baseCommit,
      "proof.json mission.source.baseCommit",
      true,
    );

    let parsedRepositoryUrl: URL;

    try {
      parsedRepositoryUrl = new URL(repositoryUrl);
    } catch {
      return invalid(
        "proof.json mission.source.repositoryUrl",
        "a valid GitHub HTTPS URL",
      );
    }

    if (
      parsedRepositoryUrl.protocol !== "https:" ||
      parsedRepositoryUrl.hostname !== "github.com"
    ) {
      invalid("proof.json mission.source.repositoryUrl", "a GitHub HTTPS URL");
    }

    if (!/^[0-9a-f]{40}$/i.test(baseCommit)) {
      invalid(
        "proof.json mission.source.baseCommit",
        "a 40-character Git commit SHA",
      );
    }

    metadata.source = {
      repositoryUrl,
      baseCommit,
    };
  }

  if (proof.checks != null) {
    const checks = object(proof.checks, "proof.json checks");

    const parsedChecks: NonNullable<MissionResult["checks"]> = {};

    if (checks.bugReproducedBeforePatch !== undefined) {
      parsedChecks.bugReproducedBeforePatch = boolean(
        checks.bugReproducedBeforePatch,
        "proof.json checks.bugReproducedBeforePatch",
      );
    }

    if (checks.reproductionPassesAfterPatch !== undefined) {
      parsedChecks.reproductionPassesAfterPatch = boolean(
        checks.reproductionPassesAfterPatch,
        "proof.json checks.reproductionPassesAfterPatch",
      );
    }

    if (checks.fullSuitePassesAfterPatch !== undefined) {
      parsedChecks.fullSuitePassesAfterPatch = boolean(
        checks.fullSuitePassesAfterPatch,
        "proof.json checks.fullSuitePassesAfterPatch",
      );
    }

    if (Object.keys(parsedChecks).length > 0) {
      metadata.checks = parsedChecks;
    }
  }
  if (proof.reproduction != null) {
    const reproduction = object(proof.reproduction, "proof.json reproduction");
    const checks = object(
      reproduction.checks,
      "proof.json reproduction.checks",
    );

    if (!Array.isArray(checks.missingRequiredOutput)) {
      invalid(
        "proof.json reproduction.checks.missingRequiredOutput",
        "an array of strings",
      );
    }

    if (!Array.isArray(checks.presentForbiddenOutput)) {
      invalid(
        "proof.json reproduction.checks.presentForbiddenOutput",
        "an array of strings",
      );
    }

    metadata.reproductionClassification = {
      reproduced: boolean(
        reproduction.reproduced,
        "proof.json reproduction.reproduced",
      ),
      checks: {
        exitCodeMatched: boolean(
          checks.exitCodeMatched,
          "proof.json reproduction.checks.exitCodeMatched",
        ),
        missingRequiredOutput: checks.missingRequiredOutput.map(
          (value, index) =>
            string(
              value,
              `proof.json reproduction.checks.missingRequiredOutput[${index}]`,
              true,
            ),
        ),
        presentForbiddenOutput: checks.presentForbiddenOutput.map(
          (value, index) =>
            string(
              value,
              `proof.json reproduction.checks.presentForbiddenOutput[${index}]`,
              true,
            ),
        ),
      },
    };
  }
  if (proof.patch != null) {
    const patch = object(proof.patch, "proof.json patch");
    if (!Array.isArray(patch.changedFiles))
      invalid("proof.json patch.changedFiles", "an array of strings");
    metadata.patch = {
      applied: boolean(patch.applied, "proof.json patch.applied"),
      baseCommit: string(patch.baseCommit, "proof.json patch.baseCommit"),
      changedFiles: patch.changedFiles.map((file, index) =>
        string(file, `proof.json patch.changedFiles[${index}]`, true),
      ),
    };
  }
  if (proof.investigation != null) {
    const investigation = object(
      proof.investigation,
      "proof.json investigation",
    );
    metadata.iterations = number(
      investigation.iterations,
      "proof.json investigation.iterations",
      true,
    );
    if (metadata.iterations < 0)
      invalid("proof.json investigation.iterations", "a nonnegative integer");
  }
  if (proof.error != null)
    metadata.error = string(proof.error, "proof.json error");
  return metadata;
}

function parseEvents(value: unknown): MissionEvent[] {
  if (!Array.isArray(value)) return invalid("events.json", "an array");
  return value.map((item, index) => {
    const label = `events.json[${index}]`;
    const event = object(item, label);
    const timestamp = string(event.timestamp, `${label}.timestamp`, true);
    if (!Number.isFinite(Date.parse(timestamp)))
      invalid(`${label}.timestamp`, "a valid date-time string");
    if (!missionStates.has(event.state as MissionState))
      invalid(`${label}.state`, "a known mission state");
    return {
      timestamp,
      state: event.state as MissionState,
      message: string(event.message, `${label}.message`),
    };
  });
}

function parseEvidence(value: unknown, filename: string): CommandEvidence {
  const evidence = object(value, filename);
  const durationMs = number(evidence.durationMs, `${filename} durationMs`);
  if (durationMs < 0) invalid(`${filename} durationMs`, "a nonnegative number");
  return {
    command: string(evidence.command, `${filename} command`, true),
    exitCode: number(evidence.exitCode, `${filename} exitCode`, true),
    stdout: string(evidence.stdout, `${filename} stdout`),
    stderr: string(evidence.stderr, `${filename} stderr`),
    durationMs,
  };
}

function assertContained(parent: string, child: string, label: string) {
  const relative = path.relative(parent, child);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Cannot read ${label}: its resolved path is outside the allowed proof directory.`,
    );
  }
}

function isMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function readArtifact(
  directory: string,
  filename: string,
): Promise<string> {
  // The filenames are constants below; artifact paths inside proof.json are never followed.
  const resolved = await realpath(path.join(directory, filename));
  assertContained(directory, resolved, filename);
  return readFile(resolved, "utf8");
}

async function readRequired(
  directory: string,
  filename: string,
): Promise<string> {
  try {
    return await readArtifact(directory, filename);
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(
        `Required proof artifact ${filename} is missing. Run the backend workflow to generate this bundle.`,
      );
    }
    throw new Error(
      `Could not read required proof artifact ${filename}: ${error instanceof Error ? error.message : "read failed"}`,
    );
  }
}

async function readOptional<T>(
  directory: string,
  filename: string,
  parse: (contents: string) => T,
  available = true,
): Promise<{ value?: T; warning?: string }> {
  if (!available) return {};
  try {
    return { value: parse(await readArtifact(directory, filename)) };
  } catch (error) {
    if (isMissing(error)) return {};
    return {
      warning: `${filename} is unavailable: ${error instanceof Error ? error.message : "read failed"}`,
    };
  }
}

export async function loadProofBundle(
  missionId: string,
): Promise<MissionViewModel> {
  if (!/^[a-zA-Z0-9_-]+$/.test(missionId)) {
    throw new Error(
      "Invalid mission ID. Use only letters, digits, underscores, and hyphens.",
    );
  }
  // Next is launched from apps/web. Keep this portable across development machines.
  const repositoryRoot = await realpath(path.resolve(process.cwd(), "../.."));
  let directory: string;
  try {
    const outputDirectory = await realpath(path.join(repositoryRoot, "output"));
    assertContained(repositoryRoot, outputDirectory, "output directory");
    directory = await realpath(path.join(outputDirectory, missionId));
    assertContained(outputDirectory, directory, "mission directory");
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(
        `Proof bundle output/${missionId} was not found. Run the backend workflow to generate it.`,
      );
    }
    throw error;
  }

  const [proofText, eventsText] = await Promise.all([
    readRequired(directory, "proof.json"),
    readRequired(directory, "events.json"),
  ]);
  const proof = parseProof(parseJson(proofText, "proof.json"), missionId);
  const events = parseEvents(parseJson(eventsText, "events.json"));
  const [report, diff, baseline, postPatch, fullSuite] = await Promise.all([
    readOptional(
      directory,
      "investigation.md",
      (contents) => contents,
      proof.available.report,
    ),
    readOptional(
      directory,
      "patch.diff",
      (contents) => contents,
      proof.available.diff,
    ),
    ...(
      [
        ["evidence/baseline-test.json", proof.available.baseline],
        ["evidence/post-patch-test.json", proof.available.postPatch],
        ["evidence/full-suite.json", proof.available.fullSuite],
      ] as const
    ).map(([filename, available]) =>
      readOptional(
        directory,
        filename,
        (contents) => parseEvidence(parseJson(contents, filename), filename),
        available,
      ),
    ),
  ]);
  const issueLines = proof.issue.trim().split(/\r?\n/);
  const mission: MissionResult = {
    status: proof.status,
    verdict: proof.verdict,
    events,
  };
  if (proof.checks) mission.checks = proof.checks;
  if (proof.reproductionClassification) {
    mission.reproduction = proof.reproductionClassification;
  }
  if (proof.patch)
    mission.patch = {
      ...proof.patch,
      ...(diff.value !== undefined && { diff: diff.value }),
    };
  if (report.value !== undefined || proof.iterations !== undefined) {
    mission.investigation = {
      ...(report.value !== undefined && { report: report.value }),
      ...(proof.iterations !== undefined && { iterations: proof.iterations }),
    };
  }
  if (baseline.value || postPatch.value || fullSuite.value) {
    mission.evidence = {
      ...(baseline.value && { baselineTest: baseline.value }),
      ...(postPatch.value && { postPatchTest: postPatch.value }),
      ...(fullSuite.value && { fullSuite: fullSuite.value }),
    };
  }
  const lastFailure = [...events]
    .reverse()
    .find((event) => event.state === "FAILED");
  const error =
    proof.error ??
    (proof.status === "FAILED" ? lastFailure?.message : undefined);
  if (error !== undefined) mission.error = error;

  return {
    mission,
    details: {
      id: proof.id,

      title: issueLines[0].trim(),

      description: issueLines.slice(1).join("\n").trim(),

      reproduction: proof.reproduction,

      fullSuite: proof.fullSuite,

      ...(proof.source && {
        source: proof.source,
      }),
    },
    warnings: [report, diff, baseline, postPatch, fullSuite].flatMap(
      (artifact) => (artifact.warning ? [artifact.warning] : []),
    ),
  };
}
