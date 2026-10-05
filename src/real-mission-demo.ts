import { prepareRepository } from "./repository/prepare.js";
import { createVerificationPlan } from "./verification/create-plan.js";
import { runMission } from "./mission/runner.js";
import { createSandbox, destroySandbox } from "./sandbox/e2b.js";
import { createHash } from "node:crypto";

import { writeProofBundle } from "./proof/bundle.js";

async function main() {
  const [repositoryUrl, issue, reproductionCommand, requiredOutput] =
    process.argv.slice(2);

  if (!repositoryUrl || !issue || !reproductionCommand) {
    throw new Error(
      [
        "Usage:",
        "",
        'pnpm real:demo <repository-url> "<issue>" "<reproduction-command>" "[required-output]"',
      ].join("\n"),
    );
  }

  const sandbox = await createSandbox();

  try {
    console.log("");
    console.log("PATCHVERDICT REAL REPOSITORY");
    console.log("");

    console.log("Preparing repository...");

    const prepared = await prepareRepository(sandbox, {
      repositoryUrl,
    });

    console.log(`Repository: ${prepared.repositoryUrl}`);

    console.log(`Commit: ${prepared.baseCommit}`);

    console.log(`Package manager: ${prepared.project.packageManager}`);

    console.log(`Test framework: ${prepared.project.testFramework}`);

    console.log("");
    console.log("Creating verification plan...");

    const verificationPlan = createVerificationPlan({
      preparedRepository: prepared,

      reproductionCommand,

      reproductionExpectation: {
        expectedExitCodes: [1],

        ...(requiredOutput
          ? {
              requiredOutput: [requiredOutput],
            }
          : {}),

        forbiddenOutput: ["Startup Error"],
      },
    });

    console.log(`Reproduction: ${verificationPlan.reproduction.command}`);

    console.log(`Full suite: ${verificationPlan.fullSuite.command}`);

    console.log("");
    console.log("Running mission...");
    console.log("");

    const missionInput = {
      issue,

      projectRoot: prepared.projectRoot,

      verificationPlan,
    };

    const result = await runMission(sandbox, missionInput);

    const repositoryName =
      new URL(prepared.repositoryUrl).pathname
        .split("/")
        .filter(Boolean)
        .at(-1)
        ?.replace(/\.git$/, "") ?? "repository";

    const safeRepositoryName = repositoryName.replace(/[^A-Za-z0-9_-]/g, "-");

    const issueHash = createHash("sha256")
      .update(issue)
      .digest("hex")
      .slice(0, 8);

    const missionId = [
      "real",
      safeRepositoryName,
      prepared.baseCommit.slice(0, 8),
      issueHash,
    ].join("-");

    const bundle = await writeProofBundle({
      missionId,

      input: missionInput,

      result,

      source: {
        repositoryUrl: prepared.repositoryUrl,

        baseCommit: prepared.baseCommit,
      },
    });

    console.log("");
    console.log("MISSION RESULT");

    console.log("");
    console.log("PROOF BUNDLE");
    console.log("----------------------------");
    console.log(`✓ ${bundle.outputDirectory}`);
    console.log(`Mission ID: ${missionId}`);

    console.log(`Execution: ${result.status}`);

    console.log(`Verdict: ${result.verdict ?? "Not available"}`);

    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    if (result.evidence?.baselineTest) {
      const baseline = result.evidence.baselineTest;

      console.log("");
      console.log("BASELINE EVIDENCE");
      console.log("-----------------");

      console.log(`Command: ${baseline.command}`);

      console.log(`Exit code: ${baseline.exitCode}`);

      console.log("");
      console.log("STDOUT:");
      console.log(baseline.stdout || "(empty)");

      console.log("");
      console.log("STDERR:");
      console.log(baseline.stderr || "(empty)");
    }

    if (result.evidence?.postPatchTest) {
      const evidence = result.evidence.postPatchTest;

      console.log("");
      console.log("POST-PATCH EVIDENCE");
      console.log("-------------------");
      console.log(`Exit code: ${evidence.exitCode}`);

      console.log("");
      console.log("STDOUT:");
      console.log(evidence.stdout || "(empty)");

      console.log("");
      console.log("STDERR:");
      console.log(evidence.stderr || "(empty)");
    }

    if (result.patch?.changedFiles.length) {
      console.log(`Changed files: ${result.patch.changedFiles.join(", ")}`);
    }
    if (result.patch?.diff) {
      console.log("");
      console.log("PATCH DIFF");
      console.log("----------");
      console.log(result.patch.diff);
    }
  } finally {
    await destroySandbox(sandbox);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
