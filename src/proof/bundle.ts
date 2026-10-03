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
    version: 1,

    mission: {
      id: missionId,

      issue: input.issue,

      reproductionTestName: input.reproductionTestName,
    },

    status: result.status,

    verdict: result.verdict ?? null,

    checks: result.checks ?? null,

    patch: result.patch
      ? {
          applied: result.patch.applied,

          baseCommit: result.patch.baseCommit,

          changedFiles: result.patch.changedFiles,
        }
      : null,
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

  return {
    outputDirectory,
  };
}
