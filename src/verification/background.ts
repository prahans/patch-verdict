import type { NormalizedRun, SuiteComparison, TestIdentity } from "../mission/third-party-types.js";

export function identityKey(test: TestIdentity): string {
  return JSON.stringify([test.testPath, test.testIdentity]);
}
const keys = (tests: TestIdentity[]) => [...new Set(tests.map(identityKey))].sort();
const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

/** Repeats must observe the same test population and pass/fail partition. */
export function stableRuns(first: NormalizedRun, second: NormalizedRun): boolean {
  return first.execution === "COMPLETED" && second.execution === "COMPLETED" &&
    same(keys(first.discovered), keys(second.discovered)) &&
    same(keys(first.passed), keys(second.passed)) && same(keys(first.failed), keys(second.failed));
}

export function targetFailed(run: NormalizedRun, target: TestIdentity): boolean {
  const key = identityKey(target);
  return run.execution === "COMPLETED" && run.errorKind === "TARGET_TEST_FAILURE" &&
    run.discovered.some(test => identityKey(test) === key) &&
    run.failed.some(test => identityKey(test) === key) &&
    !run.passed.some(test => identityKey(test) === key);
}

export function targetPassed(run: NormalizedRun, target: TestIdentity): boolean {
  const key = identityKey(target);
  return run.execution === "COMPLETED" && run.evidence.exitCode === 0 &&
    run.discovered.some(test => identityKey(test) === key) &&
    run.passed.some(test => identityKey(test) === key) && run.failed.length === 0;
}

export function compareBackground(baseline: NormalizedRun, postPatch: NormalizedRun,
  target: TestIdentity, stable = true): SuiteComparison {
  const key = identityKey(target);
  const withoutTarget = (tests: TestIdentity[]) => tests.filter(test => identityKey(test) !== key);
  const before = new Map(withoutTarget(baseline.failed).map(test => [identityKey(test), test]));
  const after = new Map(withoutTarget(postPatch.failed).map(test => [identityKey(test), test]));
  const stableBackgroundFailures = [...after].filter(([id]) => before.has(id)).map(([, test]) => test);
  const newBackgroundFailures = [...after].filter(([id]) => !before.has(id)).map(([, test]) => test);
  const resolvedBackgroundFailures = [...before].filter(([id]) => !after.has(id)).map(([, test]) => test);
  let state: SuiteComparison["state"];
  if (!stable) state = "UNSTABLE";
  else if (baseline.execution !== "COMPLETED" || postPatch.execution !== "COMPLETED" ||
    !same(keys(withoutTarget(baseline.discovered)), keys(withoutTarget(postPatch.discovered)))) state = "UNKNOWN";
  else if (newBackgroundFailures.length) state = "REGRESSED";
  // A formerly failing test counts as resolved only if it actually passed, not skipped.
  else if (resolvedBackgroundFailures.some(test => !postPatch.passed.some(passed => identityKey(passed) === identityKey(test)))) state = "UNKNOWN";
  else if (!after.size && !before.size) state = "CLEAN";
  else if (resolvedBackgroundFailures.length) state = "IMPROVED_WITH_BACKGROUND_FAILURES";
  else state = "UNCHANGED_PREEXISTING_FAILURES";
  return { baseline, postPatch, state, stableBackgroundFailures, newBackgroundFailures, resolvedBackgroundFailures };
}
