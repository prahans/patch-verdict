import { prepareRepository } from "./repository/prepare.js";
import { createVerificationPlan } from "./verification/create-plan.js";
import { runMission } from "./mission/runner.js";
import { createSandbox, destroySandbox } from "./sandbox/e2b.js";

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

    const result = await runMission(sandbox, {
      issue,

      projectRoot: prepared.projectRoot,

      verificationPlan,
    });

    console.log("");
    console.log("MISSION RESULT");

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
