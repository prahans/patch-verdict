import type { Sandbox } from "e2b";

import { investigateIssue } from "../agent/investigate.js";

import { patchIssue } from "../agent/patch.js";

import { executeTool } from "../tools/index.js";

import { runFullSuiteTool } from "../tools/run-full-suite.js";

import { determineVerdict } from "../proof/verdict.js";

import { createMissionEvent } from "./events.js";

import { getGitDiff } from "../tools/git-diff.js";

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

  let state: MissionState = "BASELINE";

  function record(nextState: MissionState, message: string) {
    state = nextState;

    const event = createMissionEvent(nextState, message);

    events.push(event);

    console.log(`[${nextState}] ${message}`);
  }

  try {
    // -------------------------
    // BASELINE
    // -------------------------

    record("BASELINE", "Running reproduction test before patch");

    const beforePatch = await executeTool(sandbox, "run_test", {
      testName: input.reproductionTestName,
    });

    if (!beforePatch.ok) {
      throw new Error(`Baseline test could not execute: ${beforePatch.error}`);
    }

    if (!("exitCode" in beforePatch.data)) {
      throw new Error("Baseline result missing exit code");
    }

    const beforeOutput = `${beforePatch.data.stdout}\n${beforePatch.data.stderr}`;

    const bugReproducedBeforePatch =
      beforePatch.data.exitCode !== 0 &&
      beforeOutput.includes(input.reproductionTestName) &&
      !beforeOutput.includes("Startup Error");

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

    record("INVESTIGATING", "AI investigation completed");

    // -------------------------
    // PATCH
    // -------------------------

    record("PATCHING", "AI patch phase started");

    const patch = await patchIssue(sandbox, input.issue, investigation.report);

    if (!patch.patchApplied) {
      throw new Error("AI did not produce a candidate patch");
    }

    record("PATCHING", "Candidate patch applied");

    const gitDiff = await getGitDiff(sandbox);

    if (!gitDiff.ok) {
      throw new Error(`Could not capture candidate patch: ${gitDiff.error}`);
    }

    if (!gitDiff.data.changed) {
      throw new Error(
        "Patch agent reported a change, but Git found no repository diff.",
      );
    }

    record("PATCHING", "Git diff captured");

    // -------------------------
    // VERIFY TARGETED TEST
    // -------------------------

    record("VERIFYING", "Running reproduction test after patch");

    const afterPatch = await executeTool(sandbox, "run_test", {
      testName: input.reproductionTestName,
    });

    if (!afterPatch.ok) {
      throw new Error(`Post-patch test could not execute: ${afterPatch.error}`);
    }

    if (!("exitCode" in afterPatch.data)) {
      throw new Error("Post-patch result missing exit code");
    }

    const reproductionPassesAfterPatch = afterPatch.data.exitCode === 0;

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

    const fullSuite = await runFullSuiteTool(sandbox);

    if (!fullSuite.ok) {
      throw new Error(`Full suite could not execute: ${fullSuite.error}`);
    }

    const fullSuitePassesAfterPatch = fullSuite.data.exitCode === 0;

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
        report: investigation.report,

        iterations: investigation.iterations,
      },

      patch: {
        applied: patch.patchApplied,

        diff: gitDiff.data.diff,
      },

      checks: {
        bugReproducedBeforePatch,

        reproductionPassesAfterPatch,

        fullSuitePassesAfterPatch,
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
