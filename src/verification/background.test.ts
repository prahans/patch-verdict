import { expect, it } from "vitest";
import { compareBackground, stableRuns, targetFailed, targetPassed } from "./background.js";
import type { NormalizedRun, TestIdentity } from "../mission/third-party-types.js";

const test = (testIdentity: string): TestIdentity => ({ testPath: "src/math.test.ts", testIdentity });
function run(passed: string[], failed: string[]): NormalizedRun {
  return { execution: "COMPLETED", ...(failed.length ? { errorKind: "TARGET_TEST_FAILURE" as const } : {}),
    discovered: [...passed, ...failed].map(test), passed: passed.map(test), failed: failed.map(name => ({ ...test(name), message: "expected result" })),
    evidence: { command: "test", exitCode: failed.length ? 1 : 0, stdout: "", stderr: "", durationMs: 1 } };
}
it("excludes exact target, preserving unrelated failures in the same file", () => {
  const result = compareBackground(run([], ["A", "B", "C"]), run(["A"], ["B", "C"]), test("A"));
  expect(result.state).toBe("UNCHANGED_PREEXISTING_FAILURES");
  expect(result.stableBackgroundFailures.map(t => t.testIdentity)).toEqual(["B", "C"]);
});
it("excludes new generated target from the post-patch background population", () => {
  expect(compareBackground(run(["B"], []), run(["A", "B"], []), test("A")).state).toBe("CLEAN");
});
it("detects a new failing identity", () => {
  expect(compareBackground(run(["C"], ["A", "B"]), run(["A"], ["B", "C"]), test("A")).state).toBe("REGRESSED");
});
it("rejects disappearing tests and unknown framework output", () => {
  expect(compareBackground(run([], ["A", "B"]), run(["A"], []), test("A")).state).toBe("UNKNOWN");
  expect(compareBackground(run([], ["A"]), { ...run(["A"], []), execution: "ERROR" }, test("A")).state).toBe("UNKNOWN");
});
it("records improvements without turning prior background failures into VERIFIED", () => {
  expect(compareBackground(run([], ["A", "B", "C"]), run(["A", "B"], ["C"]), test("A")).state).toBe("IMPROVED_WITH_BACKGROUND_FAILURES");
});
it("detects flaky populations and pass/fail changes", () => {
  expect(stableRuns(run(["B"], ["A"]), run(["A"], ["B"]))).toBe(false);
  expect(stableRuns(run(["B"], ["A"]), run(["B"], ["A"]))).toBe(true);
});
it("does not call a formerly passing background test becoming skipped clean", () => {
  const post = run(["A"], []);
  post.discovered.push(test("B"));
  expect(compareBackground(run(["B"], ["A"]), post, test("A")).state).toBe("UNKNOWN");
});
it("requires observed exact target and successful execution", () => {
  expect(targetFailed(run([], ["A"]), test("B"))).toBe(false);
  expect(targetFailed(run([], ["A"]), test("A"))).toBe(true);
  expect(targetFailed({ ...run([], ["A"]), execution: "ERROR", errorKind: "MODULE_RESOLUTION_ERROR" }, test("A"))).toBe(false);
  expect(targetPassed(run(["A"], []), test("A"))).toBe(true);
  expect(targetPassed(run(["B"], []), test("A"))).toBe(false);
});
