import type { MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";

type ProofCheckState = "passed" | "failed" | "review" | "unavailable";

const checkPresentation = {
  passed: { label: "Passed", summary: "passed", className: "is-verified", icon: "check" },
  review: { label: "Review required", summary: "review", className: "is-review", icon: "warning" },
  failed: { label: "Failed", summary: "failed", className: "is-failed", icon: "x" },
  unavailable: { label: "Unavailable", summary: "unavailable", className: "is-unavailable", icon: "minus" },
} as const;

function booleanState(value: boolean | undefined): ProofCheckState {
  if (value === true) {
    return "passed";
  }

  if (value === false) {
    return "failed";
  }

  return "unavailable";
}

export function ProofChain({ mission }: { mission: MissionResult }) {
  const reviewFlags = mission.verificationIntegrity?.reviewFlags.filter((flag) => flag.trim()) ?? [];
  const reviewReason = reviewFlags.join(" · ") ||
    "Verification independence requires human review; no specific reason was recorded.";
  const testsPassed =
    mission.checks?.reproductionPassesAfterPatch === true &&
    mission.checks?.fullSuitePassesAfterPatch === true;
  const checks: { label: string; state: ProofCheckState; detail: string }[] = [
    {
      label: "Bug reproduced before patch",

      state: booleanState(mission.checks?.bugReproducedBeforePatch),

      detail: mission.evidence?.baselineTest
        ? `Baseline · exit ${mission.evidence.baselineTest.exitCode}`
        : "Baseline evidence unavailable",
    },

    {
      label: "Candidate patch applied",

      state: booleanState(mission.patch?.applied),

      detail: mission.patch
        ? `${mission.patch.changedFiles.length} ${
            mission.patch.changedFiles.length === 1 ? "file" : "files"
          } changed`
        : "Patch metadata unavailable",
    },

    {
      label: "Git diff captured",

      state:
        mission.patch?.diff === undefined
          ? "unavailable"
          : mission.patch.diff.trim()
            ? "passed"
            : "failed",

      detail: mission.patch?.baseCommit
        ? `Against ${mission.patch.baseCommit.slice(0, 7)}`
        : "Base commit unavailable",
    },

    {
      label: "Verification integrity",

      state:
        mission.verificationIntegrity?.status === "PRESERVED"
          ? "passed"
          : mission.verificationIntegrity?.status === "REVIEW_REQUIRED"
            ? "review"
            : mission.verificationIntegrity?.status === "COMPROMISED"
              ? "failed"
              : "unavailable",

      detail:
        mission.verificationIntegrity?.status === "REVIEW_REQUIRED"
          ? reviewReason
          : mission.verificationIntegrity?.status === "COMPROMISED"
            ? mission.verificationIntegrity.violations.join(" · ") || "Verification independence was compromised"
            : mission.verificationIntegrity?.status === "PRESERVED"
              ? "Verification remained independent"
              : "Integrity analysis unavailable",
    },

    {
      label: "Reproduction passes after patch",

      state: booleanState(mission.checks?.reproductionPassesAfterPatch),

      detail: mission.evidence?.postPatchTest
        ? `Targeted test · exit ${mission.evidence.postPatchTest.exitCode}`
        : "Post-patch evidence unavailable",
    },

    {
      label: "Full test suite passes",

      state: booleanState(mission.checks?.fullSuitePassesAfterPatch),

      detail: mission.evidence?.fullSuite
        ? `Full suite · exit ${mission.evidence.fullSuite.exitCode}`
        : "Full suite evidence unavailable",
    },
  ];
  const outcomes = (["passed", "review", "failed", "unavailable"] as const)
    .map((state) => ({ state, count: checks.filter((check) => check.state === state).length }))
    .filter(({ state, count }) => state === "passed" || count > 0);
  // Display the recorded result; verdict calculation belongs to the engine.
  const verdictClass =
    mission.verdict === "VERIFIED"
      ? "is-verified"
      : mission.verdict === "REVIEW_REQUIRED"
        ? "is-review"
        : mission.verdict === "FAILED"
          ? "is-failed"
          : "is-unavailable";
  const verdictIcon =
    mission.verdict === "VERIFIED"
      ? "shield"
      : mission.verdict === "REVIEW_REQUIRED"
        ? "warning"
        : mission.verdict === "FAILED"
          ? "x"
          : "minus";

  return (
    <section className="panel proof-panel" aria-labelledby="proof-title">
      <div className="panel-header">
        <div className="panel-heading">
          <Icon name="shield" />
          <h2 id="proof-title">Proof Chain</h2>
        </div>
        <span className="layer-label">DETERMINISTIC</span>
      </div>
      <div className="proof-body">
        <div className="proof-count">
          <span>Evidence requirements</span>
          <span className="proof-count-values">
            {outcomes.map(({ state, count }, index) => (
              <span key={state} className={checkPresentation[state].className}>
                {index > 0 && <span className="proof-count-separator"> · </span>}
                {count} {checkPresentation[state].summary}
              </span>
            ))}
          </span>
        </div>
        <ol className="proof-list">
          {checks.map((check, index) => {
            const presentation = checkPresentation[check.state];

            return (
              <li key={check.label}>
                <span
                  className={`proof-check ${presentation.className}`}
                  aria-hidden="true"
                >
                  <Icon name={presentation.icon} width="13" height="13" />
                </span>
                <div className="proof-content">
                  <span className="proof-label">{check.label}</span>
                  <span className="proof-detail">
                    <span className={`proof-state ${presentation.className}`}>{presentation.label}</span>
                    {" · "}{check.detail}
                  </span>
                </div>
                <span className="proof-index">0{index + 1}</span>
              </li>
            );
          })}
        </ol>
        <div className={`verdict-result ${verdictClass}`}>
          <div className="verdict-heading">
            <Icon name={verdictIcon} width="40" height="40" />
            <div className="verdict-title">
              <span className="eyebrow">VERDICT</span>
              <strong>{mission.verdict ?? "UNAVAILABLE"}</strong>
            </div>
            <span className="verdict-seal">
              {mission.verdict ? "RECORDED\nVERDICT" : "NO VERDICT\nRECORDED"}
            </span>
          </div>
          {mission.verdict === "REVIEW_REQUIRED" && (
            <div className="verdict-explanation">
              <p className="verdict-review-title">Human review required</p>
              <p>
                {testsPassed
                  ? "Tests passed, but automatic verification was withheld."
                  : "Automatic verification was withheld."}
                {" "}Review the evidence before approving this patch.
              </p>
              {reviewFlags.length > 0 ? (
                <ul className="verdict-reasons" aria-label="Recorded review reasons">
                  {reviewFlags.map((flag, index) => <li key={`${index}-${flag}`}>{flag}</li>)}
                </ul>
              ) : (
                <p className="verdict-reason-fallback">{reviewReason}</p>
              )}
            </div>
          )}
        </div>
        <p className="proof-note">
          The saved verdict is reported by PatchVerdict.
          <br />
          AI proposes. Tools execute. Tests verify. Humans approve.
        </p>
      </div>
    </section>
  );
}
