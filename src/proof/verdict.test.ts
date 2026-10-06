import { describe, expect, it } from "vitest";

import { determineVerdict } from "./verdict.js";

describe("determineVerdict", () => {
  const passingChecks = {
    bugReproducedBeforePatch: true,
    patchApplied: true,
    reproductionPassesAfterPatch: true,
    fullSuitePassesAfterPatch: true,
    repairKind: "ROOT_CAUSE_FIX" as const,
  };

  it("returns VERIFIED when all checks pass and integrity is preserved", () => {
    const result = determineVerdict({
      ...passingChecks,
      verificationIntegrityStatus: "PRESERVED",
    });

    expect(result.status).toBe("VERIFIED");
  });

  it("returns REVIEW_REQUIRED when tests pass but integrity requires review", () => {
    const result = determineVerdict({
      ...passingChecks,
      verificationIntegrityStatus: "REVIEW_REQUIRED",
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("returns REVIEW_REQUIRED when tests pass but the repair is a workaround", () => {
    const result = determineVerdict({
      ...passingChecks,
      repairKind: "WORKAROUND",
      verificationIntegrityStatus: "PRESERVED",
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("returns REVIEW_REQUIRED when tests pass but the repair is a mitigation", () => {
    const result = determineVerdict({
      ...passingChecks,
      repairKind: "MITIGATION",
      verificationIntegrityStatus: "PRESERVED",
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
  });

  it("returns FAILED when tests pass but verification is compromised", () => {
    const result = determineVerdict({
      ...passingChecks,
      verificationIntegrityStatus: "COMPROMISED",
    });

    expect(result.status).toBe("FAILED");
  });

  it("returns FAILED when functional verification fails even if integrity is preserved", () => {
    const result = determineVerdict({
      ...passingChecks,
      fullSuitePassesAfterPatch: false,
      verificationIntegrityStatus: "PRESERVED",
    });

    expect(result.status).toBe("FAILED");
  });
});
