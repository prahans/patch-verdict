export type VerdictStatus = "VERIFIED" | "FAILED";

export type VerdictChecks = {
  bugReproducedBeforePatch: boolean;
  patchApplied: boolean;
  reproductionPassesAfterPatch: boolean;
  fullSuitePassesAfterPatch: boolean;
};

export type VerdictResult = {
  status: VerdictStatus;
  checks: VerdictChecks;
};

export function determineVerdict(checks: VerdictChecks): VerdictResult {
  const verified =
    checks.bugReproducedBeforePatch &&
    checks.patchApplied &&
    checks.reproductionPassesAfterPatch &&
    checks.fullSuitePassesAfterPatch;

  return {
    status: verified ? "VERIFIED" : "FAILED",
    checks,
  };
}
