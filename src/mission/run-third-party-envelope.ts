import { createHash } from "node:crypto";
import type { MissionEnvelope } from "./input-envelope.js";
import { prepareRepository } from "../repository/prepare.js";
import { createSandbox, destroySandbox } from "../sandbox/e2b.js";
import { runThirdPartyMission } from "./third-party-runner.js";
import type { MissionEvent, MissionInput, MissionResult } from "./types.js";
import { writeProofBundle } from "../proof/bundle.js";
import { RepositoryPreparationError } from "../repository/prepare.js";

export async function runThirdPartyEnvelope(
  input: MissionEnvelope,
  requestedMissionId?: string,
) {
  const missionId =
    requestedMissionId ??
    "issue-" +
      createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex")
        .slice(0, 16) +
      "-" +
      Date.now();
  if (!/^[A-Za-z0-9_-]+$/.test(missionId))
    throw new Error("Invalid mission ID.");
  const emit = ({
    state,
    message,
  }: Pick<MissionEvent, "state" | "message">) => {
    console.log(
      "PATCHVERDICT EVENT " +
        missionId +
        ": [" +
        state +
        "] " +
        message.replace(/[\r\n]+/g, " ").slice(0, 600),
    );
  };
  const initialEvents: MissionEvent[] = [];
  const preparing = (message: string) => {
    const event: MissionEvent = {
      state: "PREPARING",
      timestamp: new Date().toISOString(),
      message,
    };
    initialEvents.push(event);
    emit(event);
  };
  let sandbox: Awaited<ReturnType<typeof createSandbox>> | undefined;
  let result: MissionResult;
  // Proof shape stays readable even when preflight fails before a plan exists.
  const proofInput: MissionInput = {
    issue: input.issue,
    projectRoot: "/tmp/patchverdict",
    verificationPlan: {
      reproduction: {
        label: "Frozen issue-specific reproduction",
        command: "Not selected",
        expectation: { expectedExitCodes: [1] },
      },
      fullSuite: {
        label: "Background suite comparison",
        command: "Not available",
      },
    },
  };
  try {
    preparing("Target branch resolved to exact base commit");
    sandbox = await createSandbox();
    preparing("Preparing repository");
    const prepared = await prepareRepository(sandbox, {
      repositoryUrl: input.repositoryUrl,
      mode: "THIRD_PARTY_JS_TS",
      targetBranch: input.targetBranch!,
      expectedCommit: input.baseCommit!,
    });
    preparing("Repository preflight passed");
    proofInput.verificationPlan.fullSuite.command =
      prepared.project.fullSuiteCommand;
    result = await runThirdPartyMission(
      sandbox,
      { issue: input.issue, prepared, targetBranch: input.targetBranch!, reviewedRegression: input.reviewedRegression },
      { onEvent: emit },
    );
    result.events = [...initialEvents, ...result.events];
    if (result.frozenReproduction)
      proofInput.verificationPlan.reproduction.command =
        result.frozenReproduction.command;
    if (result.suiteComparison)
      proofInput.verificationPlan.fullSuite.command =
        result.suiteComparison.baseline.evidence.command;
  } catch (error) {
    const outcome =
      error instanceof RepositoryPreparationError
        ? error.outcome
        : "PREPARATION_FAILED";
    const message =
      error instanceof Error ? error.message : "Repository preparation failed.";
    const event: MissionEvent = {
      state: outcome === "UNSUPPORTED_REPOSITORY" ? "COMPLETED" : "FAILED",
      timestamp: new Date().toISOString(),
      message,
    };
    result = {
      status: outcome === "UNSUPPORTED_REPOSITORY" ? "COMPLETED" : "FAILED",
      outcome,
      verdict: null,
      events: [...initialEvents, event],
      error: message,
    };
    emit(event);
  } finally {
    if (sandbox) {
      try {
        await destroySandbox(sandbox);
      } catch {
        /* final evidence remains publishable after teardown failure */
      }
    }
  }
  const bundle = await writeProofBundle({
    missionId,
    input: proofInput,
    result,
    source: {
      mode: "THIRD_PARTY_JS_TS",
      repositoryUrl: input.repositoryUrl,
      baseCommit: input.baseCommit!,
      targetBranch: input.targetBranch!,
      defaultBranch: input.defaultBranch!,
      githubIssue: input.githubIssue!,
    },
  });
  console.log("Mission ID: " + missionId);
  console.log("Proof bundle: " + bundle.outputDirectory);
  console.log("Execution: " + result.status);
  console.log("Outcome: " + result.outcome);
  console.log("Verdict: " + (result.verdict ?? "Not available"));
}
