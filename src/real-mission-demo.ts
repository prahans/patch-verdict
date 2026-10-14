import { prepareRepository } from "./repository/prepare.js";
import { createVerificationPlan } from "./verification/create-plan.js";
import { runMission } from "./mission/runner.js";
import type { MissionEvent } from "./mission/types.js";
import { createSandbox, destroySandbox } from "./sandbox/e2b.js";
import { createHash } from "node:crypto";

import { writeProofBundle, type ProofGitHubIssue } from "./proof/bundle.js";

function issueSource(repositoryUrl: string, issue: string): ProofGitHubIssue | undefined {
  const text = process.env.PATCHVERDICT_GITHUB_ISSUE;
  if (!text) return undefined;
  // Validate the server envelope and copy only source fields. The engine
  // remains repository-oriented and receives only the reported issue context.
  try {
    const value = JSON.parse(text) as ProofGitHubIssue;
    const url = new URL(repositoryUrl);
    const repository = url.pathname.replace(/^\//, "").replace(/\.git\/?$/, "").replace(/\/$/, "");
    if (!value || typeof value !== "object" ||
      url.protocol !== "https:" || url.hostname !== "github.com" ||
      typeof value.owner !== "string" || typeof value.repository !== "string" ||
      `${value.owner}/${value.repository}` !== repository ||
      !Number.isSafeInteger(value.number) || value.number < 1 ||
      value.url !== `https://github.com/${repository}/issues/${value.number}` ||
      typeof value.title !== "string" || !value.title.trim() || value.title.length > 1024 || /[\0\r\n]/.test(value.title) ||
      (value.body !== undefined && typeof value.body !== "string") ||
      issue !== (value.body ? `${value.title}\n\n${value.body}` : value.title)) throw new Error();
    return { url: value.url, number: value.number, title: value.title, owner: value.owner, repository: value.repository,
      ...(value.body !== undefined && { body: value.body }) };
  } catch { throw new Error("The GitHub issue source metadata is invalid."); }
}

async function main() {
  const [repositoryUrl, issue, reproductionCommand, requiredOutput] =
    process.argv.slice(2);

  if (!repositoryUrl || !issue) {
    throw new Error(
      [
        "Usage:",
        "",
        'pnpm real:demo <repository-url> "<issue>" "[reproduction-command]" "[required-output]"',
      ].join("\n"),
    );
  }

  const githubIssue = issueSource(repositoryUrl, issue);
  const requestedMissionId = process.env.PATCHVERDICT_MISSION_ID?.trim();
  if (requestedMissionId !== undefined && !/^[A-Za-z0-9_-]+$/.test(requestedMissionId)) {
    throw new Error("PATCHVERDICT_MISSION_ID must contain only letters, digits, underscores, and hyphens.");
  }

  const emitLiveEvent = ({ state, message }: Pick<MissionEvent, "state" | "message">) => {
    if (requestedMissionId) {
      console.log(`PATCHVERDICT EVENT ${requestedMissionId}: [${state}] ${message.replace(/[\r\n]+/g, " ")}`);
    }
  };

  const sandbox = await createSandbox();

  try {
    console.log("");
    console.log("PATCHVERDICT REAL REPOSITORY");
    console.log("");

    console.log("Preparing repository...");
    emitLiveEvent({ state: "PREPARING", message: "Preparing repository..." });

    const prepared = await prepareRepository(sandbox, {
      repositoryUrl,
    });

    console.log(`Repository: ${prepared.repositoryUrl}`);

    console.log(`Commit: ${prepared.baseCommit}`);

    console.log(`Package manager: ${prepared.project.packageManager}`);

    console.log(`Test framework: ${prepared.project.testFramework}`);

    console.log("");
    console.log("Creating verification plan...");

    const resolvedReproductionCommand =
      reproductionCommand?.trim() || prepared.project.fullSuiteCommand;

    const verificationPlan = createVerificationPlan({
      preparedRepository: prepared,

      reproductionCommand: resolvedReproductionCommand,

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

    const result = await runMission(sandbox, missionInput, {
      onEvent: emitLiveEvent,
    });

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

    const existingGeneratedMissionId = [
      "real",
      safeRepositoryName,
      prepared.baseCommit.slice(0, 8),
      issueHash,
    ].join("-");

    const missionId = requestedMissionId ?? existingGeneratedMissionId;

    const bundle = await writeProofBundle({
      missionId,

      input: missionInput,

      result,

      source: {
        repositoryUrl: prepared.repositoryUrl,

        baseCommit: prepared.baseCommit,
        ...(githubIssue && { githubIssue }),
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
