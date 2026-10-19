import { createHash } from "node:crypto";

export function proofV3Fixture({ missionId = "fixture-divide-zero", generated = false, background = false } = {}) {
  const source = { repositoryUrl: "https://github.com/owner/repo", baseCommit: "a".repeat(40), mode: "THIRD_PARTY_JS_TS", targetBranch: "release/2.x", defaultBranch: "main", githubIssue: { owner: "owner", repository: "repo", number: 12, url: "https://github.com/owner/repo/issues/12", title: "Divide by zero", body: "Return zero instead of infinity." } };
  const target = { testPath: generated ? "src/divide.regression.test.ts" : "src/divide.test.ts", testIdentity: "divide returns zero" };
  const healthy = { testPath: "src/healthy.test.ts", testIdentity: "healthy behavior" };
  const other = { testPath: "src/other.test.ts", testIdentity: "unrelated behavior" };
  const command = "node './node_modules/vitest/vitest.mjs' run --target divide";
  const suiteCommand = "node './node_modules/vitest/vitest.mjs' run";
  const evidence = (cmd, exitCode) => ({ command: cmd, exitCode, stdout: "recorded test output", stderr: "", durationMs: 25 });
  const run = (passed, failed, cmd = suiteCommand) => ({ execution: "COMPLETED", ...(failed.length && { errorKind: "TARGET_TEST_FAILURE" }), discovered: [...passed, ...failed], passed, failed: failed.map(test => ({ ...test, message: "Expected zero" })), evidence: evidence(cmd, failed.length ? 1 : 0) });
  const baseline = run([healthy], [...(generated ? [] : [target]), ...(background ? [other] : [])]);
  const postPatch = run([healthy, target], background ? [other] : []);
  const targetBaseline = run([], [target], command);
  const targetAfter = run([target], [], command);
  const diff = "diff --git a/src/divide.ts b/src/divide.ts\n--- a/src/divide.ts\n+++ b/src/divide.ts\n@@ -1 +1 @@\n-export const divide = (a, b) => a / b;\n+export const divide = (a, b) => b === 0 ? 0 : a / b;\n";
  const proof = {
    version: 3,
    createdAt: "2026-10-18T00:00:00.000Z",
    mission: { id: missionId, issue: `${source.githubIssue.title}\n\n${source.githubIssue.body}`, source, reproduction: { label: "Frozen target", command }, fullSuite: { label: "Repository full suite", command: suiteCommand }, verificationIntegrity: { status: "PRESERVED", preserved: true, violations: [], reviewFlags: [], protectedChangedFiles: [] } },
    status: "COMPLETED", outcome: "REPAIR_EVALUATED", verdict: generated || background ? "REVIEW_REQUIRED" : "VERIFIED",
    frozenReproduction: { ...target, origin: generated ? "GENERATED_REGRESSION" : "EXISTING_TEST", framework: "vitest", command, frozenSha256: "c".repeat(64), targetBranch: source.targetBranch, baseCommit: source.baseCommit, stable: true, targetBaselineResult: targetBaseline, provenance: { issueQuote: "Return zero instead of", assertionQuote: "expect(divide(4, 0)).toBe(0)", reason: "The assertion checks the zero-denominator behavior described in the issue." } },
    targetAfter,
    backgroundBaseline: baseline,
    ...(baseline.failed.length && { backgroundBaselineRepeat: structuredClone(baseline) }),
    suiteComparison: { baseline, postPatch, state: background ? "UNCHANGED_PREEXISTING_FAILURES" : "CLEAN", stableBackgroundFailures: background ? [other] : [], newBackgroundFailures: [], resolvedBackgroundFailures: [] },
    repair: { trustedRegressionChangedFiles: generated ? [target.testPath] : [], productionChangedFiles: ["src/divide.ts"], frozenIntegrity: true, scopeValid: true },
    patch: { applied: true, baseCommit: source.baseCommit, changedFiles: ["src/divide.ts", ...(generated ? [target.testPath] : [])], sha256: createHash("sha256").update(diff).digest("hex") },
    checks: { bugReproducedBeforePatch: true, reproductionPassesAfterPatch: true, fullSuitePassesAfterPatch: !background, verificationIntegrityPreserved: true },
    error: null,
    artifacts: { patch: "patch.diff", investigation: null, events: "events.json", evidence: { baseline: "evidence/baseline-test.json", postPatch: "evidence/post-patch-test.json", fullSuite: "evidence/full-suite.json" } },
  };
  return { proof, diff, events: [], baseline: targetBaseline.evidence, postPatch: targetAfter.evidence, fullSuite: postPatch.evidence };
}
