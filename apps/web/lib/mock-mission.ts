// Frontend fixture only. These types mirror the engine's result contract without
// importing or connecting to the mission runner.
export type MissionState =
  | "PREPARING"
  | "BASELINE"
  | "INVESTIGATING"
  | "PATCHING"
  | "VERIFYING"
  | "VERDICT"
  | "COMPLETED"
  | "FAILED";

export type MissionEvent = {
  timestamp: string;
  state: MissionState;
  message: string;
};

export type CommandEvidence = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
};

export type MissionResult = {
  status: "COMPLETED" | "FAILED";
  verdict?: "VERIFIED" | "FAILED";
  events: MissionEvent[];
  investigation?: {
    report: string;
    iterations: number;
  };
  patch?: {
    applied: boolean;
    baseCommit: string;
    changedFiles: string[];
    diff: string;
  };
  checks?: {
    bugReproducedBeforePatch: boolean;
    reproductionPassesAfterPatch: boolean;
    fullSuitePassesAfterPatch: boolean;
  };
  evidence?: {
    baselineTest: CommandEvidence;
    postPatchTest: CommandEvidence;
    fullSuite: CommandEvidence;
  };
  error?: string;
};

export const missionDetails = {
  id: "PV-0042",
  title: "divide() should reject division by zero",
  description:
    'A zero divisor currently returns Infinity. The function should throw "Division by zero" while preserving valid division behavior.',
  repository: "patchverdict/divide-by-zero",
  sourcePath: "src/divide.ts",
  testPath: "tests/divide.test.ts",
  reproductionTestName: "rejects division by zero",
};

const reproductionCommand = 'npx vitest run -t "rejects division by zero"';

export const mockMission: MissionResult = {
  status: "COMPLETED",
  verdict: "VERIFIED",
  events: [
    {
      timestamp: "2026-10-03T09:41:02.000Z",
      state: "BASELINE",
      message: "Running reproduction test before patch",
    },
    {
      timestamp: "2026-10-03T09:41:02.842Z",
      state: "BASELINE",
      message: "Reported bug reproduced",
    },
    {
      timestamp: "2026-10-03T09:41:02.910Z",
      state: "INVESTIGATING",
      message: "AI investigation started",
    },
    {
      timestamp: "2026-10-03T09:41:28.604Z",
      state: "INVESTIGATING",
      message: "AI investigation completed",
    },
    {
      timestamp: "2026-10-03T09:41:28.710Z",
      state: "PATCHING",
      message: "AI patch phase started",
    },
    {
      timestamp: "2026-10-03T09:41:42.388Z",
      state: "PATCHING",
      message: "Candidate patch applied",
    },
    {
      timestamp: "2026-10-03T09:41:42.460Z",
      state: "PATCHING",
      message: "Git captured 1 changed file",
    },
    {
      timestamp: "2026-10-03T09:41:42.500Z",
      state: "VERIFYING",
      message: "Running reproduction test after patch",
    },
    {
      timestamp: "2026-10-03T09:41:43.218Z",
      state: "VERIFYING",
      message: "Reproduction test passes after patch",
    },
    {
      timestamp: "2026-10-03T09:41:43.280Z",
      state: "VERIFYING",
      message: "Running full test suite",
    },
    {
      timestamp: "2026-10-03T09:41:44.544Z",
      state: "VERIFYING",
      message: "Full test suite passes",
    },
    {
      timestamp: "2026-10-03T09:41:44.600Z",
      state: "VERDICT",
      message: "Calculating deterministic verdict",
    },
    {
      timestamp: "2026-10-03T09:41:44.621Z",
      state: "COMPLETED",
      message: "Mission completed with verdict VERIFIED",
    },
  ],
  investigation: {
    report:
      "The reported failure was reproduced. The divide() implementation directly returns `a / b` and does not validate a zero divisor. JavaScript returns Infinity for non-zero numbers divided by zero, while the repository test expects the function to throw `Division by zero`. The likely root cause is the missing `b === 0` validation.",
    iterations: 4,
  },
  patch: {
    applied: true,
    baseCommit: "a82c91f6b7e4089c352ad641e9250fbc8a763d02",
    changedFiles: ["src/divide.ts"],
    diff: `diff --git a/src/divide.ts b/src/divide.ts
--- a/src/divide.ts
+++ b/src/divide.ts
@@ -1,3 +1,7 @@
 export function divide(a: number, b: number): number {
+  if (b === 0) {
+    throw new Error("Division by zero");
+  }
+
   return a / b;
 }
`,
  },
  checks: {
    bugReproducedBeforePatch: true,
    reproductionPassesAfterPatch: true,
    fullSuitePassesAfterPatch: true,
  },
  evidence: {
    baselineTest: {
      command: reproductionCommand,
      exitCode: 1,
      durationMs: 842,
      stdout: ` RUN  v3.2.4 /workspace/repository

 ❯ tests/divide.test.ts (6 tests | 1 failed | 5 skipped) 8ms
   × divide > rejects division by zero 7ms

 Test Files  1 failed (1)
      Tests  1 failed | 5 skipped (6)
   Duration  842ms
`,
      stderr: ` FAIL  tests/divide.test.ts > divide > rejects division by zero
AssertionError: expected [Function] to throw an error

 ❯ tests/divide.test.ts:24:33
     22| describe("divide", () => {
     23|   it("rejects division by zero", () => {
     24|     expect(() => divide(6, 0)).toThrow("Division by zero");
       |                                 ^
     25|   });
`,
    },
    postPatchTest: {
      command: reproductionCommand,
      exitCode: 0,
      durationMs: 718,
      stdout: ` RUN  v3.2.4 /workspace/repository

 ✓ tests/divide.test.ts (6 tests | 5 skipped) 3ms
   ✓ divide > rejects division by zero 2ms

 Test Files  1 passed (1)
      Tests  1 passed | 5 skipped (6)
   Duration  718ms
`,
      stderr: "",
    },
    fullSuite: {
      command: "npm test",
      exitCode: 0,
      durationMs: 1264,
      stdout: `> divide-by-zero@1.0.0 test
> vitest run

 RUN  v3.2.4 /workspace/repository

 ✓ tests/divide.test.ts (6 tests) 5ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  1.26s
`,
      stderr: "",
    },
  },
};
