import type { VerificationPlan } from "../verification/types.js";
import type { ReproductionClassification } from "../verification/reproduction.js";

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

export type MissionInput = {
  issue: string;

  projectRoot: string;

  verificationPlan: VerificationPlan;
};

export type MissionChecks = {
  bugReproducedBeforePatch?: boolean;
  reproductionPassesAfterPatch?: boolean;
  fullSuitePassesAfterPatch?: boolean;
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

  checks?: MissionChecks;

  reproduction?: ReproductionClassification;

  evidence?: MissionEvidence;

  error?: string;
};

import type { CommandEvidence } from "../evidence/command-evidence.js";

export type MissionEvidence = {
  baselineTest?: CommandEvidence;
  postPatchTest?: CommandEvidence;
  fullSuite?: CommandEvidence;
};
