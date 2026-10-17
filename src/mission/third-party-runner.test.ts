import { beforeEach, expect, it, vi } from "vitest";
import type { Sandbox } from "e2b";
import type { FrozenReproduction, NormalizedRun } from "./third-party-types.js";
const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  discover: vi.fn(),
  investigate: vi.fn(),
  patch: vi.fn(),
  capture: vi.fn(),
  untouched: vi.fn(),
  hash: vi.fn(),
  policy: {
    execute: vi.fn(),
    changedFiles: ["src/math.ts"],
    allowedProductionFiles: ["src/math.ts"],
    rejectedScope: false,
  },
}));
vi.mock("../verification/framework-adapter.js", () => ({
  createFrameworkAdapter: () => ({
    command: () => "target-command",
    run: mocks.run,
  }),
}));
vi.mock("../agent/strict-reproduction.js", () => ({
  discoverReproduction: mocks.discover,
}));
vi.mock("../agent/investigate.js", () => ({
  investigateIssue: mocks.investigate,
}));
vi.mock("../agent/patch.js", () => ({ patchIssue: mocks.patch }));
vi.mock("../tools/strict-policy.js", () => ({
  createStrictRepositoryTools: () => vi.fn(),
  createStrictRepairPolicy: () => mocks.policy,
}));
vi.mock("../tools/strict-git-evidence.js", () => ({
  assertUntouchedRepository: mocks.untouched,
  captureStrictGitEvidence: mocks.capture,
  frozenFileHash: mocks.hash,
}));
import {
  runThirdPartyMission,
  type ThirdPartyMissionInput,
} from "./third-party-runner.js";
const sandbox = {} as Sandbox;
const identity = (testIdentity: string) => ({
  testPath: "src/math.test.ts",
  testIdentity,
});
const base = "a".repeat(40);
function run(
  passed: string[],
  failed: string[],
  command = "suite-command",
): NormalizedRun {
  return {
    execution: "COMPLETED",
    ...(failed.length ? { errorKind: "TARGET_TEST_FAILURE" as const } : {}),
    discovered: [...passed, ...failed].map(identity),
    passed: passed.map(identity),
    failed: failed.map((name) => ({
      ...identity(name),
      message: "expected result",
    })),
    evidence: {
      command,
      exitCode: failed.length ? 1 : 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
    },
  };
}
const frozen: FrozenReproduction = {
  ...identity("A"),
  origin: "EXISTING_TEST",
  framework: "vitest",
  command: "target-command",
  frozenSha256: "b".repeat(64),
  targetBranch: "release/2.x",
  baseCommit: base,
  stable: true,
  targetBaselineResult: run([], ["A"], "target-command"),
};
const input: ThirdPartyMissionInput = {
  issue: "A is wrong",
  targetBranch: frozen.targetBranch,
  prepared: {
    repositoryUrl: "https://github.com/fixture/repo",
    projectRoot: "/tmp/fixture",
    baseCommit: base,
    project: {
      packageManager: "npm",
      testFramework: "vitest",
      installCommand: "npm ci",
      fullSuiteCommand: "suite-command",
    },
  },
};
const git = {
  applied: true,
  changed: true,
  baseCommit: base,
  changedFiles: ["src/math.ts"],
  diff: "verified patch\n",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.policy.changedFiles = ["src/math.ts"];
  mocks.policy.allowedProductionFiles = ["src/math.ts"];
  mocks.policy.rejectedScope = false;
  mocks.untouched.mockResolvedValue(undefined);
  mocks.hash.mockResolvedValue(frozen.frozenSha256);
  mocks.capture.mockResolvedValue(git);
  mocks.discover.mockResolvedValue({ frozen, reason: "Observed target" });
  mocks.investigate.mockResolvedValue({
    completed: true,
    report: "diagnosis",
    iterations: 1,
    inspectedFiles: ["src/math.ts"],
    diagnosis: {
      rootCause: "math",
      relevantFiles: ["src/math.ts"],
      recommendedPatchTargets: ["src/math.ts"],
      patchTargetAnalysis: [
        {
          path: "src/math.ts",
          decision: "RECOMMEND",
          reason: "observed source",
        },
      ],
      evidence: [],
      confidence: "HIGH",
    },
  });
  mocks.patch.mockResolvedValue({ patchApplied: true, completed: true });
});
function sequence(...runs: NormalizedRun[]) {
  for (const result of runs) mocks.run.mockResolvedValueOnce(result);
  mocks.run.mockImplementation(() => {
    throw new Error("Unexpected extra test invocation");
  });
}
it.each(["vitest", "jest"] as const)(
  "verifies a controlled %s existing test at the selected release SHA",
  async (framework) => {
    mocks.discover.mockResolvedValue({
      frozen: { ...frozen, framework },
      reason: "Observed target",
    });
    sequence(
      run(["B"], ["A"]),
      run(["B"], ["A"]),
      run(["A"], [], "target-command"),
      run(["A", "B"], []),
    );
    const result = await runThirdPartyMission(sandbox, {
      ...input,
      prepared: {
        ...input.prepared,
        project: { ...input.prepared.project, testFramework: framework },
      },
    });
    expect(result.outcome).toBe("REPAIR_EVALUATED");
    expect(result.verdict).toBe("VERIFIED");
    expect(result.targetAfter?.passed).toEqual([identity("A")]);
    expect(result.patch?.baseCommit).toBe(base);
  },
);
it("keeps target success separate from unchanged stable B/C failures", async () => {
  sequence(
    run([], ["A", "B", "C"]),
    run([], ["A", "B", "C"]),
    run(["A"], [], "target-command"),
    run(["A"], ["B", "C"]),
    run(["A"], ["B", "C"]),
  );
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.verdict).toBe("REVIEW_REQUIRED");
  expect(result.checks?.fullSuitePassesAfterPatch).toBe(false);
  expect(result.suiteComparison?.state).toBe("UNCHANGED_PREEXISTING_FAILURES");
});
it("fails a new background regression", async () => {
  sequence(
    run(["B"], ["A"]),
    run(["B"], ["A"]),
    run(["A"], [], "target-command"),
    run(["A"], ["B"]),
    run(["A"], ["B"]),
  );
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.verdict).toBe("FAILED");
  expect(result.suiteComparison?.state).toBe("REGRESSED");
});
it("never repairs background-only failures with no issue target", async () => {
  mocks.discover.mockResolvedValue({
    reason: "No issue-specific reproduction on selected branch.",
  });
  sequence(run([], ["B"]), run([], ["B"]));
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.outcome).toBe("TARGET_NOT_REPRODUCED");
  expect(result.verdict).toBeNull();
  expect(mocks.patch).not.toHaveBeenCalled();
});
it("requires review for a frozen generated regression on a clean repository", async () => {
  mocks.discover.mockResolvedValue({
    frozen: { ...frozen, origin: "GENERATED_REGRESSION" },
    generatedPath: frozen.testPath,
    reason: "Generated target",
  });
  mocks.capture.mockResolvedValue({
    ...git,
    changedFiles: ["src/math.ts", frozen.testPath],
  });
  sequence(
    run(["B"], []),
    run(["A"], [], "target-command"),
    run(["A", "B"], []),
  );
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.verdict).toBe("REVIEW_REQUIRED");
  expect(result.repair?.trustedRegressionChangedFiles).toEqual([
    frozen.testPath,
  ]);
  expect(result.suiteComparison?.state).toBe("CLEAN");
});
it("stops before AI repair on flaky untouched baseline", async () => {
  sequence(run(["B"], ["A"]), run(["A"], ["B"]));
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.outcome).toBe("UNSTABLE_REPRODUCTION");
  expect(result.verdict).toBeNull();
  expect(mocks.discover).not.toHaveBeenCalled();
  expect(mocks.patch).not.toHaveBeenCalled();
});
it("does not reproduce framework compilation failure", async () => {
  sequence({
    ...run([], []),
    execution: "ERROR",
    errorKind: "TEST_COMPILE_ERROR",
  });
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.outcome).toBe("PREPARATION_FAILED");
  expect(result.verdict).toBeNull();
  expect(mocks.patch).not.toHaveBeenCalled();
});
it("does not silently change branch or SHA returned by discovery", async () => {
  mocks.discover.mockResolvedValue({
    frozen: { ...frozen, targetBranch: "main", baseCommit: "c".repeat(40) },
  });
  sequence(run([], ["A"]), run([], ["A"]));
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.outcome).toBe("UNSTABLE_REPRODUCTION");
  expect(mocks.patch).not.toHaveBeenCalled();
});
it("classifies unsupported multi-file repair without a forced candidate", async () => {
  mocks.policy.rejectedScope = true;
  mocks.patch.mockResolvedValue({ patchApplied: false });
  sequence(run([], ["A"]), run([], ["A"]));
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.outcome).toBe("UNSUPPORTED_REPAIR_SCOPE");
  expect(result.verdict).toBeNull();
});
it("retains FAILED when the same target still fails after one correction", async () => {
  sequence(
    run([], ["A"]),
    run([], ["A"]),
    run([], ["A"], "target-command"),
    run([], ["A"], "target-command"),
    run([], ["A"]),
    run([], ["A"]),
  );
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.outcome).toBe("REPAIR_EVALUATED");
  expect(result.verdict).toBe("FAILED");
  expect(mocks.patch).toHaveBeenCalledTimes(2);
});
it("rejects a target that passes alone but fails in the full suite", async () => {
  sequence(
    run([], ["A"]),
    run([], ["A"]),
    run(["A"], [], "target-command"),
    run([], ["A"]),
    run([], ["A"]),
  );
  expect((await runThirdPartyMission(sandbox, input)).verdict).toBe("FAILED");
});
it("detects candidate mutation during target execution and grants no correction", async () => {
  mocks.capture
    .mockResolvedValueOnce(git)
    .mockResolvedValue({ ...git, diff: "test-mutated patch\n" });
  sequence(
    run([], ["A"]),
    run([], ["A"]),
    run(["A"], [], "target-command"),
    run(["A"], []),
  );
  const result = await runThirdPartyMission(sandbox, input);
  expect(result.verdict).toBe("FAILED");
  expect(result.verificationIntegrity?.status).toBe("COMPROMISED");
  expect(mocks.patch).toHaveBeenCalledTimes(1);
});
