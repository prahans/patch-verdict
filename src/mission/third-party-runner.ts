import type { Sandbox } from "e2b";
import type { MissionEvent, MissionResult, MissionState } from "./types.js";
import type { MissionOutcome } from "./third-party-types.js";
import type { PreparedRepository } from "../repository/types.js";
import { createFrameworkAdapter } from "../verification/framework-adapter.js";
import {
  compareBackground,
  stableRuns,
  targetFailed,
  targetPassed,
} from "../verification/background.js";
import { determineThirdPartyVerdict } from "../proof/third-party-verdict.js";
import { discoverReproduction } from "../agent/strict-reproduction.js";
import { investigateIssue } from "../agent/investigate.js";
import { patchIssue } from "../agent/patch.js";
import { createInvestigationBaselineContext } from "../agent/investigation-context.js";
import {
  createStrictRepairPolicy,
  createStrictRepositoryTools,
} from "../tools/strict-policy.js";
import {
  assertUntouchedRepository,
  captureStrictGitEvidence,
  frozenFileHash,
} from "../tools/strict-git-evidence.js";
import { createMissionEvent } from "./events.js";

export type ThirdPartyMissionInput = {
  issue: string;
  prepared: PreparedRepository;
  targetBranch: string;
};

/** Strict orchestration never uses whole-suite exit status as issue reproduction. */
export async function runThirdPartyMission(
  sandbox: Sandbox,
  input: ThirdPartyMissionInput,
  options: { onEvent?: (event: MissionEvent) => void } = {},
): Promise<MissionResult> {
  const result: MissionResult = {
    status: "COMPLETED",
    verdict: null,
    events: [],
    checks: {},
    evidence: {},
  };
  const { projectRoot, baseCommit, project } = input.prepared;
  let phaseFailure: MissionOutcome = "PREPARATION_FAILED";
  let attempted = false;
  function record(state: MissionState, message: string) {
    const event = createMissionEvent(state, message);
    result.events.push(event);
    try {
      options.onEvent?.({ ...event });
    } catch {
      /* observers do not control evidence */
    }
  }
  function stop(outcome: MissionOutcome, reason: string, failed = false) {
    result.outcome = outcome;
    result.status = failed ? "FAILED" : "COMPLETED";
    result.verdict = null;
    result.error = reason;
    record(failed ? "FAILED" : "COMPLETED", reason);
    return result;
  }
  try {
    if (project.testFramework !== "vitest" && project.testFramework !== "jest")
      return stop(
        "UNSUPPORTED_REPOSITORY",
        "A supported test framework is required.",
      );
    const adapter = createFrameworkAdapter(project.testFramework, projectRoot);
    record("BASELINE", "Capturing untouched background suite");
    const baseline = await adapter.run(sandbox);
    await assertUntouchedRepository(sandbox, projectRoot, baseCommit);
    if (baseline.execution !== "COMPLETED")
      return stop(
        "PREPARATION_FAILED",
        "The untouched suite could not execute as a supported test run.",
      );
    if (baseline.failed.length) {
      const repeated = await adapter.run(sandbox);
      await assertUntouchedRepository(sandbox, projectRoot, baseCommit);
      if (!stableRuns(baseline, repeated))
        return stop(
          "UNSTABLE_REPRODUCTION",
          "Untouched test failures are unstable; no repair was attempted.",
        );
    }
    record(
      "BASELINE",
      baseline.failed.length
        ? "Stable pre-existing failures recorded"
        : "Untouched background suite is clean",
    );
    phaseFailure = "INVESTIGATION_FAILED";
    record("REPRODUCING", "Searching for issue-specific reproduction");
    const discovery = await discoverReproduction(
      sandbox,
      {
        issue: input.issue,
        projectRoot,
        framework: project.testFramework,
        adapter,
        baseline,
        targetBranch: input.targetBranch,
        baseCommit,
      },
      (message) => record("REPRODUCING", message),
    );
    await assertUntouchedRepository(
      sandbox,
      projectRoot,
      baseCommit,
      discovery.generatedPath,
    );
    if (!discovery.frozen)
      return stop(
        discovery.unstable ? "UNSTABLE_REPRODUCTION" : "TARGET_NOT_REPRODUCED",
        discovery.reason,
      );
    const frozen = discovery.frozen;
    result.frozenReproduction = frozen;
    result.evidence!.baselineTest = frozen.targetBaselineResult.evidence;
    if (
      !frozen.stable ||
      frozen.baseCommit !== baseCommit ||
      frozen.targetBranch !== input.targetBranch ||
      frozen.framework !== project.testFramework ||
      frozen.command !== adapter.command(frozen) ||
      !targetFailed(frozen.targetBaselineResult, frozen) ||
      (frozen.origin === "EXISTING_TEST" && !targetFailed(baseline, frozen)) ||
      (await frozenFileHash(sandbox, projectRoot, frozen.testPath)) !==
        frozen.frozenSha256
    ) {
      return stop(
        "UNSTABLE_REPRODUCTION",
        "The target reproduction could not be frozen consistently.",
      );
    }
    result.checks!.bugReproducedBeforePatch = true;
    record("REPRODUCING", "Target reproduced and frozen");

    record("INVESTIGATING", "AI investigation started");
    const readTools = createStrictRepositoryTools(projectRoot);
    const investigation = await investigateIssue(
      sandbox,
      input.issue,
      createInvestigationBaselineContext(frozen.targetBaselineResult.evidence),
      {
        execute: async (toolSandbox, name, toolInput) =>
          name === "run_test"
            ? {
                ok: true as const,
                data: (await adapter.run(toolSandbox, frozen)).evidence,
              }
            : readTools(toolSandbox, name, toolInput),
        context: {
          frozenReproduction: frozen,
          backgroundFailures: baseline.failed,
        },
      },
    );
    await assertUntouchedRepository(
      sandbox,
      projectRoot,
      baseCommit,
      discovery.generatedPath,
    );
    if (!investigation.completed)
      return stop(
        "INVESTIGATION_FAILED",
        "Investigation did not complete.",
        true,
      );
    result.investigation = {
      report: investigation.report,
      iterations: investigation.iterations,
      diagnosis: investigation.diagnosis,
      inspectedFiles: investigation.inspectedFiles,
    };
    const allowedProductionFiles =
      investigation.diagnosis.recommendedPatchTargets.filter(
        (file) =>
          investigation.inspectedFiles.includes(file) &&
          investigation.diagnosis.patchTargetAnalysis.some(
            (entry) => entry.path === file && entry.decision === "RECOMMEND",
          ),
      );
    const policy = createStrictRepairPolicy({
      projectRoot,
      allowedProductionFiles,
      frozenTestPath: frozen.testPath,
    });
    if (!policy.allowedProductionFiles.length)
      return stop(
        "UNSUPPORTED_REPAIR_SCOPE",
        "No grounded production repair target is available.",
      );
    const context = {
      report: investigation.report,
      diagnosis: investigation.diagnosis,
    };
    phaseFailure = "PATCH_FAILED";
    record("PATCHING", "AI patch phase started");
    const patch = await patchIssue(
      sandbox,
      input.issue,
      context,
      undefined,
      policy,
    );
    attempted = patch.patchApplied;
    if (!attempted)
      return stop(
        policy.rejectedScope ? "UNSUPPORTED_REPAIR_SCOPE" : "PATCH_FAILED",
        policy.rejectedScope
          ? "The repair requires changes outside the supported one-file scope."
          : "No candidate production patch was produced.",
        !policy.rejectedScope,
      );

    const capture = async () => {
      const git = await captureStrictGitEvidence(
        sandbox,
        projectRoot,
        baseCommit,
        discovery.generatedPath,
      );
      const production = git.changedFiles.filter(
        (file) => file !== discovery.generatedPath,
      );
      const frozenIntegrity =
        (await frozenFileHash(sandbox, projectRoot, frozen.testPath)) ===
        frozen.frozenSha256;
      const scopeValid =
        production.length === 1 &&
        production.every(
          (file) =>
            allowedProductionFiles.includes(file) &&
            policy.changedFiles.includes(file),
        );
      const trusted =
        discovery.generatedPath &&
        git.changedFiles.includes(discovery.generatedPath)
          ? [discovery.generatedPath]
          : [];
      const provenanceValid =
        frozen.origin === "GENERATED_REGRESSION"
          ? trusted.length === 1 && trusted[0] === frozen.testPath
          : trusted.length === 0;
      result.patch = {
        applied: git.changed,
        baseCommit: git.baseCommit,
        changedFiles: git.changedFiles,
        diff: git.diff,
      };
      result.repair = {
        trustedRegressionChangedFiles: trusted,
        productionChangedFiles: production,
        frozenIntegrity,
        scopeValid: scopeValid && provenanceValid,
      };
      const preserved = frozenIntegrity && scopeValid && provenanceValid;
      result.verificationIntegrity = {
        status: preserved ? "PRESERVED" : "COMPROMISED",
        preserved,
        violations: preserved
          ? []
          : ["The frozen target or authorized repair scope changed."],
        reviewFlags: [],
        protectedChangedFiles: frozenIntegrity ? [] : [frozen.testPath],
      };
      result.checks!.verificationIntegrityPreserved = preserved;
      return preserved;
    };
    phaseFailure = "VERIFICATION_FAILED";
    let integrity = await capture();
    record("VERIFYING", "Running frozen reproduction after patch");
    let candidateDiff = result.patch!.diff;
    let postTarget = await adapter.run(sandbox, frozen);
    integrity =
      (await capture()) && integrity && result.patch!.diff === candidateDiff;
    result.evidence!.postPatchTest = postTarget.evidence;
    if (
      integrity &&
      !targetPassed(postTarget, frozen) &&
      postTarget.execution === "COMPLETED"
    ) {
      record("PATCHING", "Starting the single correction attempt");
      phaseFailure = "PATCH_FAILED";
      await patchIssue(
        sandbox,
        input.issue,
        context,
        { ...postTarget.evidence, candidateDiff: result.patch!.diff },
        policy,
      );
      phaseFailure = "VERIFICATION_FAILED";
      integrity = await capture();
      candidateDiff = result.patch!.diff;
      postTarget = await adapter.run(sandbox, frozen);
      integrity =
        (await capture()) && integrity && result.patch!.diff === candidateDiff;
      result.evidence!.postPatchTest = postTarget.evidence;
    }
    result.targetAfter = postTarget;
    record("VERIFYING", "Comparing non-target suite failures");
    const postSuite = await adapter.run(sandbox);
    let stablePost = true;
    if (postSuite.failed.length)
      stablePost = stableRuns(postSuite, await adapter.run(sandbox));
    // Test execution itself must not mutate the candidate or its frozen oracle.
    const verifiedDiff = result.patch!.diff;
    integrity =
      (await capture()) && integrity && result.patch!.diff === verifiedDiff;
    result.suiteComparison = compareBackground(
      baseline,
      postSuite,
      frozen,
      stablePost,
    );
    result.evidence!.fullSuite = postSuite.evidence;
    const sameTarget = (test: { testPath: string; testIdentity: string }) =>
      test.testPath === frozen.testPath &&
      test.testIdentity === frozen.testIdentity;
    const targetVerified =
      targetPassed(postTarget, frozen) &&
      postTarget.evidence.command === frozen.command &&
      postSuite.execution === "COMPLETED" &&
      postSuite.passed.some(sameTarget) &&
      !postSuite.failed.some(sameTarget);
    result.checks!.reproductionPassesAfterPatch = targetVerified;
    result.checks!.fullSuitePassesAfterPatch =
      postSuite.execution === "COMPLETED" && postSuite.evidence.exitCode === 0;
    result.checks!.verificationIntegrityPreserved = integrity;
    if (!integrity && result.verificationIntegrity) {
      result.verificationIntegrity.status = "COMPROMISED";
      result.verificationIntegrity.preserved = false;
      result.verificationIntegrity.violations.push(
        "Verification changed the candidate or its evidence.",
      );
    }
    result.outcome = "REPAIR_EVALUATED";
    record("VERDICT", "Calculating deterministic verdict");
    result.verdict = determineThirdPartyVerdict({
      outcome: result.outcome,
      reproductionOrigin: frozen.origin,
      targetReproduced: true,
      reproductionStable: frozen.stable,
      frozenIntegrity: result.repair!.frozenIntegrity,
      repairAttempted: attempted,
      repairScopeValid: result.repair!.scopeValid,
      targetPassesAfterPatch: targetVerified,
      backgroundComparison: result.suiteComparison.state,
      verificationIntegrity: integrity,
    });
    record("COMPLETED", "Mission completed with verdict " + result.verdict);
    return result;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Strict mission execution failed.";
    if (
      attempted &&
      /integrity|frozen|HEAD changed|Unexpected untracked|Unsupported file mode/i.test(
        message,
      )
    ) {
      result.status = "COMPLETED";
      result.outcome = "REPAIR_EVALUATED";
      result.verdict = "FAILED";
      result.error = message;
      result.verificationIntegrity = {
        status: "COMPROMISED",
        preserved: false,
        violations: [message],
        reviewFlags: [],
        protectedChangedFiles: [],
      };
      record("COMPLETED", "Candidate failed verification integrity");
      return result;
    }
    return stop(phaseFailure, message, true);
  }
}
