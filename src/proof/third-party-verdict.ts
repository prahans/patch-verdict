import type { BackgroundState, MissionOutcome } from "../mission/third-party-types.js";
import type { VerdictStatus } from "./verdict.js";

export type ThirdPartyVerdictInputs = {
  outcome: MissionOutcome;
  reproductionOrigin?: "EXISTING_TEST" | "GENERATED_REGRESSION" | "REVIEWED_REGRESSION";
  targetReproduced: boolean;
  reproductionStable: boolean;
  frozenIntegrity: boolean;
  repairAttempted: boolean;
  repairScopeValid: boolean;
  targetPassesAfterPatch: boolean;
  backgroundComparison: BackgroundState;
  verificationIntegrity: boolean;
};

/** No model output is a verdict input. Unknown verification cannot authorize publication. */
export function determineThirdPartyVerdict(input: ThirdPartyVerdictInputs): VerdictStatus | null {
  if (input.outcome !== "REPAIR_EVALUATED") return null;
  if (!input.repairAttempted || !input.targetReproduced || !input.reproductionStable ||
    !input.frozenIntegrity || !input.repairScopeValid || !input.targetPassesAfterPatch ||
    !input.verificationIntegrity || ["REGRESSED", "UNKNOWN", "UNSTABLE"].includes(input.backgroundComparison)) return "FAILED";
  if (input.reproductionOrigin === "EXISTING_TEST" && input.backgroundComparison === "CLEAN") return "VERIFIED";
  if (input.reproductionOrigin === "EXISTING_TEST" || (input.reproductionOrigin === "GENERATED_REGRESSION" || input.reproductionOrigin === "REVIEWED_REGRESSION")) return "REVIEW_REQUIRED";
  return "FAILED";
}
