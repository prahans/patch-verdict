import type { CommandEvidence } from "../evidence/command-evidence.js";

/** Version 3 semantics. Legacy/manual missions retain their version 2 policy. */
export type MissionOutcome =
  | "REPAIR_EVALUATED" | "TARGET_NOT_REPRODUCED" | "UNSTABLE_REPRODUCTION"
  | "UNSUPPORTED_REPOSITORY" | "UNSUPPORTED_REPAIR_SCOPE" | "PREPARATION_FAILED"
  | "INVESTIGATION_FAILED" | "PATCH_FAILED" | "VERIFICATION_FAILED";
export type FrameworkErrorKind =
  | "TARGET_TEST_FAILURE" | "NO_TESTS_FOUND" | "TEST_PARSE_ERROR" | "TEST_COMPILE_ERROR"
  | "MODULE_RESOLUTION_ERROR" | "FRAMEWORK_STARTUP_ERROR" | "CONFIGURATION_ERROR"
  | "TIMEOUT" | "INFRASTRUCTURE_ERROR";
export type TestIdentity = { testPath: string; testIdentity: string };
export type TestFailure = TestIdentity & { message: string };
export type NormalizedRun = {
  execution: "COMPLETED" | "ERROR";
  errorKind?: FrameworkErrorKind;
  discovered: TestIdentity[];
  passed: TestIdentity[];
  failed: TestFailure[];
  evidence: CommandEvidence;
};
export type FrozenReproduction = TestIdentity & {
  origin: "EXISTING_TEST" | "GENERATED_REGRESSION" | "REVIEWED_REGRESSION";
  framework: "vitest" | "jest";
  command: string;
  frozenSha256: string;
  targetBranch: string;
  baseCommit: string;
  stable: boolean;
  targetBaselineResult: NormalizedRun;
  provenance?: {
    issueQuote: string;
    assertionQuote: string;
    reason: string;
  };
};
export type BackgroundState = "CLEAN" | "UNCHANGED_PREEXISTING_FAILURES" | "REGRESSED"
  | "IMPROVED_WITH_BACKGROUND_FAILURES" | "UNSTABLE" | "UNKNOWN";
export type SuiteComparison = {
  baseline: NormalizedRun;
  postPatch: NormalizedRun;
  state: BackgroundState;
  stableBackgroundFailures: TestIdentity[];
  newBackgroundFailures: TestIdentity[];
  resolvedBackgroundFailures: TestIdentity[];
};
export type RepairProvenance = {
  trustedRegressionChangedFiles: string[];
  productionChangedFiles: string[];
  frozenIntegrity: boolean;
  scopeValid: boolean;
};
