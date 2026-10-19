import type { MissionState } from "./mission-types";
import type { GitHubIssue } from "./github-issue-url";

export type MissionLiveEvent = {
  timestamp: string;
  state: MissionState;
  message: string;
};

export type MissionLiveStatus = {
  missionId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  phase: MissionState;
  message: string;
  repositoryUrl: string;
  issue: string;
  githubIssue?: GitHubIssue;
  mode?: "THIRD_PARTY_JS_TS";
  targetBranch?: string;
  baseCommit?: string;
  defaultBranch?: string;
  startedAt: string;
  updatedAt: string;
  deadlineAt: string;
  proofReady: boolean;
  events: MissionLiveEvent[];
  error?: string;
};

export function isSafeMissionId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

const knownMessages: Partial<Record<MissionState, readonly string[]>> = {
  PREPARING: ["Preparing repository...", "Preparing repository", "Target branch resolved to exact base commit", "Repository preflight passed"],
  BASELINE: ["Running reproduction test before patch", "Reported bug reproduced", "Capturing untouched background suite", "Stable pre-existing failures recorded", "Untouched background suite is clean"],
  REPRODUCING: ["Searching for issue-specific reproduction", "No existing target test found", "Generating bounded regression test", "Correcting generated regression before freeze", "Target reproduced and frozen"],
  INVESTIGATING: ["AI investigation started", "AI investigation completed"],
  PATCHING: [
    "AI patch phase started", "Candidate patch applied", "Git diff captured",
    "Verification integrity preserved", "Reproduction failed; starting the single correction attempt",
    "Starting the single correction attempt",
  ],
  VERIFYING: [
    "Running reproduction test after patch", "Reproduction test passes after patch",
    "Reproduction test still fails", "Running reproduction test after correction",
    "Reproduction test passes after correction",
    "Reproduction test still fails after correction; no correction attempts remain",
    "Running full test suite", "Full test suite passes", "Full test suite fails",
    "Running frozen reproduction after patch", "Comparing non-target suite failures",
  ],
  VERDICT: ["Calculating deterministic verdict"],
  COMPLETED: [
    "Mission completed with verdict VERIFIED", "Mission completed with verdict REVIEW_REQUIRED",
    "Mission completed with verdict FAILED",
    "Candidate failed verification integrity",
  ],
};

// Only the CLI's event observer tags each event with the server-generated ID.
// Raw AI/repository logs and evidence summaries do not carry this envelope.
export function parseBackendEventLine(line: string, missionId: string): Omit<MissionLiveEvent, "timestamp"> | null {
  if (!isSafeMissionId(missionId)) return null;
  const prefix = `PATCHVERDICT EVENT ${missionId}: `;
  if (!line.startsWith(prefix)) return null;
  const match = /^\[(PREPARING|BASELINE|REPRODUCING|INVESTIGATING|PATCHING|VERIFYING|VERDICT|COMPLETED|FAILED)\] (.+)$/.exec(line.slice(prefix.length).replace(/\r$/, ""));
  if (!match) return null;
  const state = match[1] as MissionState;
  const message = match[2];
  if (knownMessages[state]?.includes(message)) return { state, message };
  if (state === "COMPLETED") return { state, message: "Mission stopped. Recording the canonical outcome." };
  if (state === "PATCHING" && /^Git captured \d+ changed file\(s\)$/.test(message)) {
    return { state, message };
  }
  if (state === "PATCHING" && message.startsWith("Verification requires human review:")) {
    return { state, message: "Verification requires human review" };
  }
  if (state === "PATCHING" && message.startsWith("Verification integrity compromised:")) {
    return { state, message: "Verification integrity compromised" };
  }
  if (state === "FAILED") {
    // Backend exceptions may contain provider credentials or internal paths.
    return { state, message: "The backend reported a failure. Recording available proof." };
  }
  return null;
}
