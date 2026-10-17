import type { MissionDetails, MissionResult } from "./mission-types";
import { assertProofV3Consistency } from "./proof-v3";

export type PullRequestResult = { number: number; url: string; draft: boolean };

export function isPullRequestResult(value: unknown): value is PullRequestResult {
  if (!value || typeof value !== "object") return false;
  const pr = value as Record<string, unknown>;
  return Number.isSafeInteger(pr.number) && (pr.number as number) > 0 &&
    typeof pr.draft === "boolean" && typeof pr.url === "string" &&
    /^https:\/\/github\.com\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/.test(pr.url) &&
    pr.url.endsWith(`/pull/${pr.number}`);
}

// This is presentation policy only. The server reloads and verifies every artifact.
export function getPullRequestEligibility(mission: MissionResult, details: MissionDetails) {
  const draft = mission.verdict === "REVIEW_REQUIRED";
  if (mission.status !== "COMPLETED" || !["VERIFIED", "REVIEW_REQUIRED"].includes(mission.verdict ?? "")) {
    return { allowed: false, draft, reason: "Only completed VERIFIED or REVIEW_REQUIRED missions can create a pull request." };
  }
  if (!mission.patch?.applied || !mission.patch.changedFiles.length || !mission.patch.diff ||
    !details.source?.repositoryUrl || !/^[a-f0-9]{40}$/i.test(details.source.baseCommit) ||
    mission.patch.baseCommit.toLowerCase() !== details.source.baseCommit.toLowerCase()) {
    return { allowed: false, draft, reason: "The canonical proof is missing the patch or its repository and base commit." };
  }
  if (!mission.patch.sha256 || !/^[a-f0-9]{64}$/.test(mission.patch.sha256)) {
    return { allowed: false, draft, reason: "This proof has no verified patch digest. Run a new mission to enable pull request creation." };
  }
  // Refuse contradictory persisted evidence without recomputing or changing the
  // recorded verdict. Older bundles may omit these optional evidence fields.
  const integrity = mission.verificationIntegrity;
  if (details.source.mode === "THIRD_PARTY_JS_TS") {
    try {
      assertProofV3Consistency(mission, details.source);
      return { allowed: true, draft };
    } catch {
      return { allowed: false, draft, reason: "The strict proof does not contain consistent target, background, and frozen repair evidence." };
    }
  }
  if (mission.error || Object.entries(mission.checks ?? {}).some(([key, value]) => key !== "verificationIntegrityPreserved" && value === false) ||
    mission.reproduction?.reproduced === false ||
    (mission.evidence?.postPatchTest && mission.evidence.postPatchTest.exitCode !== 0) ||
    (mission.evidence?.fullSuite && mission.evidence.fullSuite.exitCode !== 0) ||
    integrity?.status === "COMPROMISED" || (integrity && integrity.violations.length > 0) ||
    (!draft && (mission.checks?.verificationIntegrityPreserved === false ||
      (integrity && (integrity.status !== "PRESERVED" || !integrity.preserved || integrity.reviewFlags.length > 0)))) ||
    (draft && integrity && integrity.status !== "REVIEW_REQUIRED")) {
    return { allowed: false, draft, reason: "The recorded verification evidence conflicts with the verdict. Pull request creation is unavailable." };
  }
  return { allowed: true, draft };
}
