import type {
  MissionResult,
  VerificationIntegrityStatus,
} from "../mission-types";

export type BenchmarkScenario = {
  id: string;
  name: string;
  repositoryUrl: string;
  missionId: string;
};

export type RecordedVerdict = "VERIFIED" | "REVIEW_REQUIRED" | "FAILED";
export type BenchmarkAvailability = "valid" | "unavailable";

// Only this small projection crosses the server/client boundary. No raw logs,
// issue bodies, artifact paths, errors, or investigation reports are included.
export type BenchmarkRow = {
  id: string;
  scenario: string;
  repository: string | null;
  missionId: string;
  availability: BenchmarkAvailability;
  unavailableReason: string | null;
  executionStatus: MissionResult["status"] | null;
  verdict: RecordedVerdict | null;
  baselineReproduced: boolean | null;
  postPatchPassed: boolean | null;
  fullSuitePassed: boolean | null;
  integrity: VerificationIntegrityStatus | null;
  changedFiles: number | null;
  baseCommit: string | null;
  iterations: number | null;
  testDurationMs: number | null;
  timedCommandCount: number;
  commandDurations: {
    baseline: number | null;
    postPatch: number | null;
    fullSuite: number | null;
  };
  missionDurationMs: number | null;
  evidenceUrl: string | null;
  evidenceWarnings: boolean;
};

export type BenchmarkSummary = {
  configured: number;
  valid: number;
  verified: number;
  reviewRequired: number;
  failed: number;
  noVerdict: number;
  unavailable: number;
  validWithoutVerdict: number;
  // Percentage points (0–100): VERIFIED / all configured scenarios, including unavailable scenarios.
  verificationRate: number | null;
  testDurationMs: number | null;
  timedCommandCount: number;
  timedMissionCount: number;
};

export type BenchmarkDashboardData = {
  benchmarks: BenchmarkRow[];
  otherMissions: BenchmarkRow[];
  summary: BenchmarkSummary;
  notices: string[];
  outputState: "available" | "missing" | "unavailable";
  discoveryTruncated: boolean;
};
