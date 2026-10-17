import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import path from "node:path";

import type { MissionInput, MissionResult } from "../mission/types.js";

export type ProofGitHubIssue = {
  url: string;
  number: number;
  title: string;
  owner: string;
  repository: string;
  body?: string | undefined;
};

type ProofSource = {
  repositoryUrl: string;
  baseCommit: string;
  githubIssue?: ProofGitHubIssue;
  mode?: "THIRD_PARTY_JS_TS";
  targetBranch?: string;
  defaultBranch?: string;
};

type ProofBundleInput = {
  missionId: string;

  input: MissionInput;

  result: MissionResult;

  source?: ProofSource;
};

export async function writeProofBundle({
  missionId,
  input,
  result,
  source,
}: ProofBundleInput) {
  if (!/^[A-Za-z0-9_-]+$/.test(missionId)) {
    throw new Error("Invalid mission ID.");
  }

  const outputRoot = path.resolve(process.cwd(), "output");

  const outputDirectory = path.join(outputRoot, missionId);

  await mkdir(outputRoot, {
    recursive: true,
  });

  const strict = source?.mode === "THIRD_PARTY_JS_TS";
  if (strict) {
    // An exclusive directory claim prevents overwriting finalized proof or racing writers.
    await mkdir(outputDirectory);
  } else {
    await rm(outputDirectory, { recursive: true, force: true });
    await mkdir(outputDirectory, { recursive: true });
  }

  // Digest the very same UTF-8 buffer written below, including its trailing LF.
  const patchBytes = result.patch ? Buffer.from(strict ? result.patch.diff : `${result.patch.diff}\n`, "utf8") : undefined;
  const proof = {
    version: strict ? 3 : 2,
    ...(strict && {
      outcome: result.outcome,
      frozenReproduction: result.frozenReproduction ?? null,
      targetAfter: result.targetAfter ?? null,
      suiteComparison: result.suiteComparison ?? null,
      repair: result.repair ?? null,
      error: result.error ?? null,
    }),

    mission: {
      id: missionId,

      issue: input.issue,

      source: source
        ? {
            repositoryUrl: source.repositoryUrl,

            baseCommit: source.baseCommit,
            ...(source.githubIssue && { githubIssue: source.githubIssue }),
            ...(strict && { mode: source.mode, targetBranch: source.targetBranch, defaultBranch: source.defaultBranch }),
          }
        : null,

      reproduction: {
        label: input.verificationPlan.reproduction.label,

        command: input.verificationPlan.reproduction.command,
      },

      verificationIntegrity: result.verificationIntegrity
        ? {
            status: result.verificationIntegrity.status,

            preserved: result.verificationIntegrity.preserved,

            violations: result.verificationIntegrity.violations,

            reviewFlags: result.verificationIntegrity.reviewFlags,

            protectedChangedFiles:
              result.verificationIntegrity.protectedChangedFiles,
          }
        : null,

      fullSuite: {
        label: input.verificationPlan.fullSuite.label,

        command: input.verificationPlan.fullSuite.command,
      },
    },

    status: result.status,

    verdict: result.verdict ?? null,

    checks: result.checks ?? null,

    reproduction: result.reproduction
      ? {
          reproduced: result.reproduction.reproduced,

          checks: {
            exitCodeMatched: result.reproduction.checks.exitCodeMatched,

            missingRequiredOutput:
              result.reproduction.checks.missingRequiredOutput,

            presentForbiddenOutput:
              result.reproduction.checks.presentForbiddenOutput,
          },
        }
      : null,

    investigation: result.investigation
      ? {
          iterations: result.investigation.iterations,

          diagnosis: result.investigation.diagnosis,

          inspectedFiles: result.investigation.inspectedFiles,
        }
      : null,

    patch: result.patch
      ? {
          applied: result.patch.applied,

          baseCommit: result.patch.baseCommit,

          changedFiles: result.patch.changedFiles,
          sha256: createHash("sha256").update(patchBytes!).digest("hex"),
        }
      : null,

    artifacts: {
      patch: result.patch ? "patch.diff" : null,

      investigation: result.investigation ? "investigation.md" : null,

      events: "events.json",

      evidence: result.evidence
        ? {
            baseline: result.evidence.baselineTest
              ? "evidence/baseline-test.json"
              : null,

            postPatch: result.evidence.postPatchTest
              ? "evidence/post-patch-test.json"
              : null,

            fullSuite: result.evidence.fullSuite
              ? "evidence/full-suite.json"
              : null,
          }
        : null,
    },
  };

  const proofJson = JSON.stringify(proof, null, 2);
  if (Buffer.byteLength(proofJson) > 16 * 1024 * 1024 || (patchBytes?.length ?? 0) > 2 * 1024 * 1024) {
    throw new Error("Proof artifacts exceed the bounded publication size.");
  }
  await writeFile(
    path.join(outputDirectory, "events.json"),

    JSON.stringify(result.events, null, 2),

    "utf8",
  );

  if (result.patch) {
    await writeFile(
      path.join(outputDirectory, "patch.diff"),

      patchBytes!,
    );
  }

  if (result.investigation) {
    await writeFile(
      path.join(outputDirectory, "investigation.md"),

      `# Investigation Report

${result.investigation.report}
`,

      "utf8",
    );
  }

  const evidenceDirectory = path.join(outputDirectory, "evidence");

  await mkdir(evidenceDirectory, {
    recursive: true,
  });

  if (result.evidence?.baselineTest) {
    await writeFile(
      path.join(evidenceDirectory, "baseline-test.json"),
      JSON.stringify(result.evidence.baselineTest, null, 2),
      "utf8",
    );
  }

  if (result.evidence?.postPatchTest) {
    await writeFile(
      path.join(evidenceDirectory, "post-patch-test.json"),
      JSON.stringify(result.evidence.postPatchTest, null, 2),
      "utf8",
    );
  }

  if (result.evidence?.fullSuite) {
    await writeFile(
      path.join(evidenceDirectory, "full-suite.json"),
      JSON.stringify(result.evidence.fullSuite, null, 2),
      "utf8",
    );
  }

  // Publish the unchanged manifest last: its presence means every referenced
  // artifact is fully written, and readers never observe partial proof JSON.
  const temporaryProof = path.join(outputDirectory, "proof.json.tmp");
  await writeFile(temporaryProof, proofJson, "utf8");
  await rename(temporaryProof, path.join(outputDirectory, "proof.json"));

  return {
    outputDirectory,
  };
}
