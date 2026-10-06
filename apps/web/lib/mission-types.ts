// UI data contract for serialized proof bundles. Keep this independent of the engine.
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
  verdict?: "VERIFIED" | "REVIEW_REQUIRED" | "FAILED" | null;
  events: MissionEvent[];
  investigation?: {
    report?: string;
    iterations?: number;
  };
  patch?: {
    applied: boolean;
    authorization?: {
      intentId: string;
      authorizedPath: string;
      objective: string;
      repairKind?: "ROOT_CAUSE_FIX" | "WORKAROUND" | "MITIGATION";
      evidenceRefs: Array<{
        kind: "FILE" | "TEST" | "SEARCH" | "EXPERIMENT";
        source: string;
      }>;
    };
    baseCommit: string;
    changedFiles: string[];
    diff?: string;
  };
  checks?: {
    bugReproducedBeforePatch?: boolean;
    reproductionPassesAfterPatch?: boolean;
    fullSuitePassesAfterPatch?: boolean;
    verificationIntegrityPreserved?: boolean;
    patchMatchesAuthorization?: boolean;
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
  };

  repository?: string;
  sourcePath?: string;
  testPath?: string;
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
