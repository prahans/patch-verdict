import { mkdir, writeFile } from "node:fs/promises";

import path from "node:path";

import type { MissionInput, MissionResult } from "../mission/types.js";

type ProofBundleInput = {
  missionId: string;

  input: MissionInput;

  result: MissionResult;
};

export async function writeProofBundle({
  missionId,
  input,
  result,
}: ProofBundleInput) {
  const outputDirectory = path.resolve(process.cwd(), "output", missionId);

  await mkdir(outputDirectory, {
    recursive: true,
  });

  const proof = {
    version: 2,

    mission: {
      id: missionId,

      issue: input.issue,

      reproduction: {
        label: input.verificationPlan.reproduction.label,

        command: input.verificationPlan.reproduction.command,
      },

      fullSuite: {
        label: input.verificationPlan.fullSuite.label,

        command: input.verificationPlan.fullSuite.command,
      },
    },

    status: result.status,

    verdict: result.verdict ?? null,

    checks: result.checks ?? null,

    investigation: result.investigation
      ? { iterations: result.investigation.iterations }
      : null,

    patch: result.patch
      ? {
          applied: result.patch.applied,

          baseCommit: result.patch.baseCommit,

          changedFiles: result.patch.changedFiles,
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

  await writeFile(
    path.join(outputDirectory, "proof.json"),

    JSON.stringify(proof, null, 2),

    "utf8",
  );

  await writeFile(
    path.join(outputDirectory, "events.json"),

    JSON.stringify(result.events, null, 2),

    "utf8",
  );

  if (result.patch) {
    await writeFile(
      path.join(outputDirectory, "patch.diff"),

      `${result.patch.diff}\n`,

      "utf8",
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

  return {
    outputDirectory,
  };
}
