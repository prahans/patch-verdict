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
  ["integrity", "Verification integrity"],
  ["reproduction", "Post-patch reproduction"],
  ["suite", "Full test suite"],
  ["verdict", "Final verdict"],
] as const;

// Replay persisted events in order. Neither time nor a later phase implies that
// a missing check passed; a correction can replace an earlier failed check.
export function buildLiveProofChain(
  status: Pick<MissionLiveStatus, "events" | "phase" | "status" | "mode">,
): LiveProofStep[] {
  if (status.mode === "THIRD_PARTY_JS_TS") return buildThirdPartyLiveChain(status);
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

function buildThirdPartyLiveChain(status: Pick<MissionLiveStatus, "events" | "status">): LiveProofStep[] {
  const steps: LiveProofStep[] = [["baseline", "Untouched background suite"], ["target", "Issue-specific frozen target"], ["investigation", "Repository investigation"], ["patch", "One-file production repair"], ["reproduction", "Frozen target after repair"], ["suite", "Non-target background comparison"], ["verdict", "Recorded outcome / verdict"]].map(([id, label]) => ({ id, label, state: "WAITING" }));
  const set = (id: string, state: LiveProofState, detail?: string) => {
    if (state === "RUNNING") for (const step of steps) if (step.state === "RUNNING") step.state = "WAITING";
    const step = steps.find(item => item.id === id)!;
    step.state = state; step.detail = detail;
  };
  for (const event of status.events) {
    const message = event.message;
    if (event.state === "BASELINE") {
      if (message === "Capturing untouched background suite") set("baseline", "RUNNING");
      if (message === "Stable pre-existing failures recorded") set("baseline", "REVIEW", "Stable pre-existing failures");
      if (message === "Untouched background suite is clean") set("baseline", "PASSED", "Clean untouched suite");
    }
    if (event.state === "REPRODUCING") {
      if (message === "Searching for issue-specific reproduction") set("target", "RUNNING");
      if (message === "Generating bounded regression test") set("target", "RUNNING", "Generated oracle requires review");
      if (message === "Target reproduced and frozen") set("target", "PASSED", "Stable target frozen");
    }
    if (event.state === "INVESTIGATING" && message === "AI investigation started") set("investigation", "RUNNING");
    if (event.state === "INVESTIGATING" && message === "AI investigation completed") set("investigation", "PASSED");
    if (event.state === "PATCHING" && ["AI patch phase started", "Starting the single correction attempt"].includes(message)) set("patch", "RUNNING");
    if (event.state === "PATCHING" && message === "Candidate patch applied") set("patch", "PASSED");
    if (event.state === "VERIFYING" && message === "Running frozen reproduction after patch") set("reproduction", "RUNNING");
    if (event.state === "VERIFYING" && message === "Comparing non-target suite failures") set("suite", "RUNNING");
    if (event.state === "VERDICT") set("verdict", "RUNNING");
    if (event.state === "COMPLETED") {
      const verdict = /^Mission completed with verdict (VERIFIED|REVIEW_REQUIRED|FAILED)$/.exec(message)?.[1];
      if (verdict) set("verdict", verdict === "VERIFIED" ? "PASSED" : verdict === "REVIEW_REQUIRED" ? "REVIEW" : "FAILED", verdict);
      else set("verdict", "REVIEW", "Recording canonical outcome");
      for (const step of steps) if (step.state === "RUNNING") step.state = "WAITING";
    }
  }
  if (status.status === "FAILED") {
    for (const step of steps) if (step.state === "RUNNING") step.state = "FAILED";
    set("verdict", "FAILED", "EXECUTION FAILED");
  }
  return steps;
}
