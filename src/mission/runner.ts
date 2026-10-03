import type { Sandbox } from "e2b";

import { investigateIssue } from "../agent/investigate.js";

import { patchIssue } from "../agent/patch.js";

import { executeTool } from "../tools/index.js";

import { runVerificationCommand } from "../verification/run-command.js";

import { determineVerdict } from "../proof/verdict.js";

import { createMissionEvent } from "./events.js";

import { getGitEvidence } from "../tools/git-evidence.js";
import { didReproduceBug } from "../verification/reproduction.js";

import type {
  MissionEvent,
  MissionInput,
  MissionResult,
  MissionState,
} from "./types.js";

export async function runMission(
  sandbox: Sandbox,
  input: MissionInput,
): Promise<MissionResult> {
  const events: MissionEvent[] = [];

  function record(nextState: MissionState, message: string) {
    const event = createMissionEvent(nextState, message);

    events.push(event);

    console.log(`[${nextState}] ${message}`);
  }

  try {
    // -------------------------
    // BASELINE
    // -------------------------

    record("BASELINE", "Running reproduction test before patch");

    const baselineEvidence = await runVerificationCommand(
      sandbox,
      input.projectRoot,
      input.verificationPlan.reproduction,
    );

    const bugReproducedBeforePatch = didReproduceBug(baselineEvidence);

    if (!bugReproducedBeforePatch) {
      throw new Error("Reported bug could not be reproduced");
    }

    record("BASELINE", "Reported bug reproduced");

    // -------------------------
    // INVESTIGATION
    // -------------------------

    record("INVESTIGATING", "AI investigation started");

    const investigation = await investigateIssue(sandbox, input.issue);

    if (!investigation.completed) {
      throw new Error("AI investigation did not complete");
    }

    const investigationReport =
      typeof investigation.report === "string"
        ? investigation.report
        : investigation.report
            .map((part) => (part.type === "text" ? part.text : ""))
            .join("\n");

    record("INVESTIGATING", "AI investigation completed");

    // -------------------------
    // PATCH
    // -------------------------

    record("PATCHING", "AI patch phase started");

    const patch = await patchIssue(sandbox, input.issue, investigationReport);

    if (!patch.patchApplied) {
      throw new Error("AI did not produce a candidate patch");
    }

    record("PATCHING", "Candidate patch applied");

    const gitEvidence = await getGitEvidence(sandbox);

    if (!gitEvidence.ok) {
      throw new Error(`Could not capture Git evidence: ${gitEvidence.error}`);
    }

    if (!gitEvidence.data.changed) {
      throw new Error(
        "AI reported a patch, but Git detected no repository changes.",
      );
    }

    record(
      "PATCHING",
      `Git captured ${gitEvidence.data.changedFiles.length} changed file(s)`,
    );

    record("PATCHING", "Git diff captured");

    // -------------------------
    // VERIFY TARGETED TEST
    // -------------------------

    record("VERIFYING", "Running reproduction test after patch");

    const postPatchEvidence = await runVerificationCommand(
      sandbox,
      input.projectRoot,
      input.verificationPlan.reproduction,
    );

    const reproductionPassesAfterPatch = postPatchEvidence.exitCode === 0;

    record(
      "VERIFYING",
      reproductionPassesAfterPatch
        ? "Reproduction test passes after patch"
        : "Reproduction test still fails",
    );

    // -------------------------
    // VERIFY FULL SUITE
    // -------------------------

    record("VERIFYING", "Running full test suite");

    const fullSuiteEvidence = await runVerificationCommand(
      sandbox,
      input.projectRoot,
      input.verificationPlan.fullSuite,
    );

    const fullSuitePassesAfterPatch = fullSuiteEvidence.exitCode === 0;

    record(
      "VERIFYING",
      fullSuitePassesAfterPatch
        ? "Full test suite passes"
        : "Full test suite fails",
    );

    // -------------------------
    // VERDICT
    // -------------------------

    record("VERDICT", "Calculating deterministic verdict");

    const verdict = determineVerdict({
      bugReproducedBeforePatch,

      patchApplied: patch.patchApplied,

      reproductionPassesAfterPatch,

      fullSuitePassesAfterPatch,
    });

    record("COMPLETED", `Mission completed with verdict ${verdict.status}`);

    return {
      status: "COMPLETED",

      verdict: verdict.status,

      events,

      investigation: {
        report: investigationReport,
        iterations: investigation.iterations,
      },

      patch: {
        applied: patch.patchApplied,
        baseCommit: gitEvidence.data.baseCommit,
        changedFiles: gitEvidence.data.changedFiles,
        diff: gitEvidence.data.diff,
      },

      checks: {
        bugReproducedBeforePatch,
        reproductionPassesAfterPatch,
        fullSuitePassesAfterPatch,
      },

      evidence: {
        baselineTest: baselineEvidence,
        postPatchTest: postPatchEvidence,
        fullSuite: fullSuiteEvidence,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown mission failure";

    record("FAILED", message);

    return {
      status: "FAILED",
      events,
      error: message,
    };
  }
}
