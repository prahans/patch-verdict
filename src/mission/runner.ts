import type { Sandbox } from "e2b";

import { investigateIssue } from "../agent/investigate.js";
import { planRepair } from "../agent/plan-repair.js";
import { assertCausalFreezeReadyForPlanning } from "../agent/causal-freeze.js";
import { causalFreezeGroundingContext } from "../agent/create-causal-freeze.js";

import { patchIssue } from "../agent/patch.js";

import { runVerificationCommand } from "../verification/run-command.js";

import { determineVerdict } from "../proof/verdict.js";

import { createMissionEvent } from "./events.js";

import { getGitEvidence } from "../tools/git-evidence.js";
import { classifyReproduction } from "../verification/reproduction.js";
import { analyzeVerificationIntegrity } from "../verification/integrity.js";
import { createInvestigationBaselineContext } from "../agent/investigation-context.js";
import { assertPatchAuthorizationMatchesChangedFiles } from "../agent/patch-authorization.js";
import {
  createDeterministicReconnaissance,
  reconnaissanceSummary,
} from "../agent/reconnaissance.js";

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
  const checks: NonNullable<MissionResult["checks"]> = {};

  const evidence: NonNullable<MissionResult["evidence"]> = {};

  let reproductionResult: MissionResult["reproduction"];

  let investigationResult: MissionResult["investigation"];

  let patchResult: MissionResult["patch"];
  let verificationIntegrityResult: MissionResult["verificationIntegrity"];

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

    evidence.baselineTest = baselineEvidence;

    const reproductionClassification = classifyReproduction(
      baselineEvidence,
      input.verificationPlan.reproduction.expectation,
    );

    reproductionResult = reproductionClassification;

    checks.bugReproducedBeforePatch = reproductionClassification.reproduced;

    const bugReproducedBeforePatch = reproductionClassification.reproduced;

    if (!bugReproducedBeforePatch) {
      const checks = reproductionClassification.checks;

      throw new Error(
        [
          "Reported bug could not be reproduced according to the verification expectation.",

          `Exit code matched: ${checks.exitCodeMatched}`,

          `Missing required output: ${
            checks.missingRequiredOutput.length > 0
              ? checks.missingRequiredOutput.join(", ")
              : "none"
          }`,

          `Forbidden output present: ${
            checks.presentForbiddenOutput.length > 0
              ? checks.presentForbiddenOutput.join(", ")
              : "none"
          }`,
        ].join("\n"),
      );
    }

    record("BASELINE", "Reported bug reproduced");

    // -------------------------
    // INVESTIGATION
    // -------------------------

    record("INVESTIGATING", "Deterministic reconnaissance started");

    const requiredOutput =
      input.verificationPlan.reproduction.expectation.requiredOutput;

    const investigationBaseline = createInvestigationBaselineContext({
      command: baselineEvidence.command,

      exitCode: baselineEvidence.exitCode,

      stdout: baselineEvidence.stdout,

      stderr: baselineEvidence.stderr,

      ...(requiredOutput !== undefined
        ? {
            requiredOutput,
          }
        : {}),
    });

    const reconnaissance = await createDeterministicReconnaissance(
      sandbox,
      input.projectRoot,
      investigationBaseline,
    );

    record(
      "INVESTIGATING",
      `Deterministic reconnaissance completed: ${reconnaissance.preInspectedFiles.length} pre-inspected file(s), ${reconnaissance.inventory.length} discovered file(s)`,
    );

    record("INVESTIGATING", "AI investigation started");

    const investigation = await investigateIssue(
      sandbox,
      input.issue,
      investigationBaseline,
      reconnaissance,
      input.projectRoot,
    );

    if (!investigation.completed) {
      throw new Error("AI investigation did not complete");
    }

    const investigationReport = investigation.report;

    investigationResult = {
      report: investigationReport,

      iterations: investigation.iterations,

      reconnaissance: reconnaissanceSummary(reconnaissance),

      hypothesisBoard: investigation.hypothesisBoard,

      experiments: investigation.experiments,

      causalFreeze: investigation.causalFreeze,

      causalEvidence: investigation.causalEvidence,
    };

    record("INVESTIGATING", `Causal decision: ${investigation.causalFreeze.status}`);

    // Save the decision above before enforcing the gate, so deferred evidence
    // survives in failed mission proof bundles. No planner or patcher runs then.
    assertCausalFreezeReadyForPlanning(
      investigation.causalFreeze,
      causalFreezeGroundingContext(investigation.causalEvidence),
    );

    record("INVESTIGATING", "Cause frozen — repair planning started");
    const planned = await planRepair({
      causalFreeze: investigation.causalFreeze,
      causalEvidence: investigation.causalEvidence,
      discoveredFiles: investigation.discoveredFiles,
    });
    investigationResult.report = `${investigationReport}\n\nRepair plan:\n${planned.report}`;
    investigationResult.diagnosis = planned.diagnosis;
    record("INVESTIGATING", "Grounded repair planning completed");

    // -------------------------
    // PATCH
    // -------------------------

    record("PATCHING", "AI patch phase started");

    const patch = await patchIssue(sandbox, input.issue, {
      report: investigationResult.report,

      diagnosis: planned.diagnosis,
    });

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

    patchResult = {
      applied: patch.patchApplied,

      ...(patch.authorization && {
        authorization: patch.authorization,
      }),

      baseCommit: gitEvidence.data.baseCommit,
      changedFiles: gitEvidence.data.changedFiles,
      diff: gitEvidence.data.diff,
    };

    if (!patch.authorization) {
      checks.patchMatchesAuthorization = false;

      throw new Error(
        "Candidate patch was applied without patch authorization evidence.",
      );
    }

    try {
      assertPatchAuthorizationMatchesChangedFiles(
        patch.authorization,
        gitEvidence.data.changedFiles,
      );

      checks.patchMatchesAuthorization = true;

      record(
        "PATCHING",
        `Git diff matches authorized intent ${patch.authorization.intentId}`,
      );
    } catch (error) {
      checks.patchMatchesAuthorization = false;

      throw error;
    }

    record("PATCHING", "Git diff captured");

    verificationIntegrityResult = analyzeVerificationIntegrity({
      changedFiles: gitEvidence.data.changedFiles,

      diff: gitEvidence.data.diff,
    });

    checks.verificationIntegrityPreserved =
      verificationIntegrityResult.preserved;

    if (verificationIntegrityResult.status === "COMPROMISED") {
      record(
        "PATCHING",
        `Verification integrity compromised: ${verificationIntegrityResult.violations.join(
          " ",
        )}`,
      );
    } else if (verificationIntegrityResult.status === "REVIEW_REQUIRED") {
      record(
        "PATCHING",
        `Verification requires human review: ${verificationIntegrityResult.reviewFlags.join(
          " ",
        )}`,
      );
    } else {
      record("PATCHING", "Verification integrity preserved");
    }

    // -------------------------
    // VERIFY TARGETED TEST
    // -------------------------

    record("VERIFYING", "Running reproduction test after patch");

    const postPatchEvidence = await runVerificationCommand(
      sandbox,
      input.projectRoot,
      input.verificationPlan.reproduction,
    );

    evidence.postPatchTest = postPatchEvidence;

    const reproductionPassesAfterPatch = postPatchEvidence.exitCode === 0;

    checks.reproductionPassesAfterPatch = reproductionPassesAfterPatch;

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

    evidence.fullSuite = fullSuiteEvidence;

    const fullSuitePassesAfterPatch = fullSuiteEvidence.exitCode === 0;

    checks.fullSuitePassesAfterPatch = fullSuitePassesAfterPatch;

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

      verificationIntegrityStatus:
        verificationIntegrityResult?.status ?? "COMPROMISED",

      repairKind: patch.authorization.repairKind,
    });

    record("COMPLETED", `Mission completed with verdict ${verdict.status}`);

    return {
      status: "COMPLETED",

      verdict: verdict.status,

      events,

      ...(investigationResult && {
        investigation: investigationResult,
      }),

      ...(patchResult && {
        patch: patchResult,
      }),

      ...(reproductionResult && {
        reproduction: reproductionResult,
      }),

      ...(Object.keys(checks).length > 0 && {
        checks,
      }),

      ...(verificationIntegrityResult && {
        verificationIntegrity: verificationIntegrityResult,
      }),

      ...(Object.keys(evidence).length > 0 && {
        evidence,
      }),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown mission failure";

    record("FAILED", message);

    return {
      status: "FAILED",

      events,

      ...(investigationResult && {
        investigation: investigationResult,
      }),

      ...(patchResult && {
        patch: patchResult,
      }),

      ...(reproductionResult && {
        reproduction: reproductionResult,
      }),

      ...(Object.keys(checks).length > 0 && {
        checks,
      }),

      ...(verificationIntegrityResult && {
        verificationIntegrity: verificationIntegrityResult,
      }),

      ...(Object.keys(evidence).length > 0 && {
        evidence,
      }),

      error: message,
    };
  }
}
