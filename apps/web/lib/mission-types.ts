import type { GitHubIssue } from "./github-issue-url";
import type { FrozenReproduction, MissionOutcome, NormalizedRun, RepairProvenance, SuiteComparison } from "../../../src/mission/third-party-types";
export type { FrozenReproduction, MissionOutcome, NormalizedRun, RepairProvenance, SuiteComparison } from "../../../src/mission/third-party-types";

// UI data contract for serialized proof bundles. Keep this independent of the engine.
export type MissionState =
  | "PREPARING"
  | "BASELINE"
  | "REPRODUCING"
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
  proofVersion?: 2 | 3;
  status: "COMPLETED" | "FAILED";
  outcome?: MissionOutcome;
  frozenReproduction?: FrozenReproduction;
  targetAfter?: NormalizedRun;
  backgroundBaseline?: NormalizedRun;
  backgroundBaselineRepeat?: NormalizedRun;
  suiteComparison?: SuiteComparison;
  repair?: RepairProvenance;
  verdict?: "VERIFIED" | "REVIEW_REQUIRED" | "FAILED" | null;
  events: MissionEvent[];
  investigation?: {
    report?: string;
    iterations?: number;
  };
  patch?: {
    applied: boolean;
    baseCommit: string;
    changedFiles: string[];
    diff?: string;
    sha256?: string;
  };
  checks?: {
    bugReproducedBeforePatch?: boolean;
    reproductionPassesAfterPatch?: boolean;
    fullSuitePassesAfterPatch?: boolean;
    verificationIntegrityPreserved?: boolean;
  };
  reproduction?: ReproductionClassification;
  verificationIntegrity?: VerificationIntegrity;
  evidence?: {
    baselineTest?: CommandEvidence;
    postPatchTest?: CommandEvidence;
    fullSuite?: CommandEvidence;
  };
  error?: string;
};

export type MissionDetails = {
  id: string;
  title: string;
  description: string;

  reproduction: {
    label: string;
    command: string;
  };

  fullSuite: {
    label: string;
    command: string;
  };

  source?: {
    repositoryUrl: string;
    baseCommit: string;
    githubIssue?: GitHubIssue;
    mode?: "THIRD_PARTY_JS_TS";
    targetBranch?: string;
    defaultBranch?: string;
  };

  repository?: string;
  sourcePath?: string;
  testPath?: string;
  testCommand?: string;
};

export type MissionViewModel = {
  mission: MissionResult;
  details: MissionDetails;
  warnings: string[];
};

export type ReproductionClassification = {
  reproduced: boolean;

  checks: {
    exitCodeMatched: boolean;

    missingRequiredOutput: string[];

    presentForbiddenOutput: string[];
  };
};

export type VerificationIntegrityStatus =
  | "PRESERVED"
  | "REVIEW_REQUIRED"
  | "COMPROMISED";

export type VerificationIntegrity = {
  status: VerificationIntegrityStatus;

  preserved: boolean;

  violations: string[];

  reviewFlags: string[];

  protectedChangedFiles: string[];
};
