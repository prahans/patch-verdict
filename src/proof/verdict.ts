import type { VerificationIntegrityStatus } from "../verification/integrity.js";

export type VerdictStatus = "VERIFIED" | "REVIEW_REQUIRED" | "FAILED";

export type VerdictChecks = {
  bugReproducedBeforePatch: boolean;

  patchApplied: boolean;

  reproductionPassesAfterPatch: boolean;

  fullSuitePassesAfterPatch: boolean;

  verificationIntegrityStatus: VerificationIntegrityStatus;
};

export type VerdictResult = {
  status: VerdictStatus;
  checks: VerdictChecks;
};

export function determineVerdict(checks: VerdictChecks): VerdictResult {
  const functionalChecksPassed =
    checks.bugReproducedBeforePatch &&
    checks.patchApplied &&
    checks.reproductionPassesAfterPatch &&
    checks.fullSuitePassesAfterPatch;

  let status: VerdictStatus;

  if (!functionalChecksPassed) {
    status = "FAILED";
  } else if (checks.verificationIntegrityStatus === "COMPROMISED") {
    status = "FAILED";
  } else if (checks.verificationIntegrityStatus === "REVIEW_REQUIRED") {
    status = "REVIEW_REQUIRED";
  } else {
    status = "VERIFIED";
  }

  return {
    status,
    checks,
  };
}
