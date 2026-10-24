import type { MissionLiveStatus } from "./mission-live-types";

export type LiveProofState =
  | "WAITING"
  | "RUNNING"
  | "PASSED"
  | "REVIEW"
  | "FAILED";
export type LiveProofStep = {
  id: string;
  label: string;
  state: LiveProofState;
  detail?: string;
};

const definitions = [
  ["baseline", "Baseline reproduction"],
  ["investigation", "Repository investigation"],
  ["patch", "Candidate patch"],
  ["diff", "Git diff"],
  ["integrity", "Integrity checks"],
  ["reproduction", "Post-patch reproduction"],
  ["suite", "Repository test script"],
  ["verdict", "Repair verdict"],
] as const;

// Replay persisted events in order. Neither time nor a later phase implies that
// a missing check passed; a correction can replace an earlier failed check.
export function buildLiveProofChain(
  status: Pick<MissionLiveStatus, "events" | "phase" | "status">,
): LiveProofStep[] {
  const steps: LiveProofStep[] = definitions.map(([id, label]) => ({
    id,
    label,
    state: "WAITING",
  }));
  function set(index: number, state: LiveProofState, detail?: string) {
    steps[index].state = state;
    steps[index].detail = detail;
  }
  function running(index: number) {
    for (const step of steps)
      if (step.state === "RUNNING") step.state = "WAITING";
    set(index, "RUNNING");
  }

  for (const event of status.events) {
    const message = event.message;
    switch (event.state) {
      case "BASELINE":
        if (message === "Running reproduction test before patch") running(0);
        if (message === "Reported bug reproduced") set(0, "PASSED");
        break;
      case "INVESTIGATING":
        if (message === "AI investigation started") running(1);
        if (message === "AI investigation completed") set(1, "PASSED");
        break;
      case "PATCHING":
        if (message === "AI patch phase started") running(2);
        if (message === "Candidate patch applied") {
          set(2, "PASSED");
        }
        if (/^Git captured \d+ changed file\(s\)$/.test(message)) running(3);
        if (message === "Git diff captured") {
          set(3, "PASSED");
          running(4);
        }
        if (message === "Verification integrity preserved") set(4, "PASSED");
        if (/^Verification requires human review(?::|$)/.test(message))
          set(4, "REVIEW");
        if (/^Verification integrity compromised(?::|$)/.test(message))
          set(4, "FAILED");
        if (
          message ===
          "Reproduction failed; starting the single correction attempt"
        ) {
          // The patch is being corrected; reproduction has not started again.
          // Keep its recorded failure until an actual rerun supplies new evidence.
          for (const step of steps)
            if (step.state === "RUNNING") step.state = "WAITING";
        }
        break;
      case "VERIFYING":
        if (
          /^Running reproduction test after (patch|correction)$/.test(message)
        )
          running(5);
        if (/^Reproduction test passes after (patch|correction)$/.test(message))
          set(5, "PASSED");
        if (
          /^Reproduction test still fails(?:$| after correction(?:;|$))/.test(
            message,
          )
        )
          set(5, "FAILED");
        if (message === "Running full test suite") running(6);
        if (message === "Full test suite passes") set(6, "PASSED");
        if (message === "Full test suite fails") set(6, "FAILED");
        break;
      case "VERDICT":
        if (message === "Calculating deterministic verdict") running(7);
        break;
      case "COMPLETED": {
        const match =
          /^Mission completed with verdict (VERIFIED|REVIEW_REQUIRED|FAILED)$/.exec(
            message,
          );
        if (match)
          set(
            7,
            match[1] === "VERIFIED"
              ? "PASSED"
              : match[1] === "REVIEW_REQUIRED"
                ? "REVIEW"
                : "FAILED",
            match[1],
          );
        break;
      }
    }
  }

  if (status.status === "FAILED") {
    for (const step of steps)
      if (step.state === "RUNNING") step.state = "FAILED";
    if (!steps[7].detail) set(7, "FAILED", "EXECUTION FAILED");
  } else if (status.status === "COMPLETED") {
    for (const step of steps)
      if (step.state === "RUNNING") step.state = "WAITING";
  }
  return steps;
}
