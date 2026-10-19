import { describe, expect, it } from "vitest";
import { determineThirdPartyVerdict, type ThirdPartyVerdictInputs } from "./third-party-verdict.js";

const clean: ThirdPartyVerdictInputs = { outcome: "REPAIR_EVALUATED", reproductionOrigin: "EXISTING_TEST",
  targetReproduced: true, reproductionStable: true, frozenIntegrity: true, repairAttempted: true,
  repairScopeValid: true, targetPassesAfterPatch: true, backgroundComparison: "CLEAN", verificationIntegrity: true };
describe("strict deterministic verdict", () => {
  it("verifies an existing target with clean background", () => expect(determineThirdPartyVerdict(clean)).toBe("VERIFIED"));
  it.each(["CLEAN", "UNCHANGED_PREEXISTING_FAILURES", "IMPROVED_WITH_BACKGROUND_FAILURES"] as const)("never verifies a generated oracle with %s", backgroundComparison => {
    expect(determineThirdPartyVerdict({ ...clean, reproductionOrigin: "GENERATED_REGRESSION", backgroundComparison })).toBe("REVIEW_REQUIRED");
  });
  it.each(["CLEAN", "UNCHANGED_PREEXISTING_FAILURES"] as const)(
    "never automatically verifies a user-reviewed regression with %s background",
    backgroundComparison => {
      expect(determineThirdPartyVerdict({
        ...clean,
        reproductionOrigin: "REVIEWED_REGRESSION",
        backgroundComparison,
      })).toBe("REVIEW_REQUIRED");
    },
  );
  it("permits target fix with unchanged failures only for review", () => expect(determineThirdPartyVerdict({ ...clean, backgroundComparison: "UNCHANGED_PREEXISTING_FAILURES" })).toBe("REVIEW_REQUIRED"));
  it.each(["REGRESSED", "UNKNOWN", "UNSTABLE"] as const)("fails %s verification", backgroundComparison => expect(determineThirdPartyVerdict({ ...clean, backgroundComparison })).toBe("FAILED"));
  it.each(["targetReproduced", "reproductionStable", "frozenIntegrity", "repairAttempted", "repairScopeValid", "targetPassesAfterPatch", "verificationIntegrity"] as const)("fails when %s is absent", field => expect(determineThirdPartyVerdict({ ...clean, [field]: false })).toBe("FAILED"));
  it.each(["TARGET_NOT_REPRODUCED", "UNSTABLE_REPRODUCTION", "UNSUPPORTED_REPOSITORY", "UNSUPPORTED_REPAIR_SCOPE", "PREPARATION_FAILED", "INVESTIGATION_FAILED", "PATCH_FAILED", "VERIFICATION_FAILED"] as const)("has no verdict for %s", outcome => expect(determineThirdPartyVerdict({ ...clean, outcome })).toBeNull());
});
