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
  reproductionTestName: string;
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
    diff: string;
  };

  checks?: {
    bugReproducedBeforePatch: boolean;
    reproductionPassesAfterPatch: boolean;
    fullSuitePassesAfterPatch: boolean;
  };

  error?: string;
};
