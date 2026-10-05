import type { MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";

type ProofCheckState = "passed" | "failed" | "review" | "unavailable";

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
  const checks = [
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
          ? mission.verificationIntegrity.reviewFlags.join(" · ")
          : mission.verificationIntegrity?.status === "COMPROMISED"
            ? mission.verificationIntegrity.violations.join(" · ")
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
  const passedCount = checks.filter((check) => check.state === "passed").length;

  const reviewCount = checks.filter((check) => check.state === "review").length;
  // Display the recorded result; verdict calculation belongs to the engine.
  const verdictClass =
    mission.verdict === "VERIFIED"
      ? "is-verified"
      : mission.verdict === "FAILED"
        ? "is-failed"
        : "is-unavailable";

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
          <span
            className={
              reviewCount > 0
                ? "amber"
                : passedCount === checks.length
                  ? "green"
                  : "amber"
            }
          >
            {reviewCount > 0
              ? `${passedCount} passed · ${reviewCount} review`
              : `${passedCount}/${checks.length} satisfied`}
          </span>
        </div>
        <ol className="proof-list">
          {checks.map((check, index) => (
            <li key={check.label}>
              <span
                className={`proof-check ${
                  check.state === "passed"
                    ? "green"
                    : check.state === "failed"
                      ? "is-failed"
                      : check.state === "review"
                        ? "amber"
                        : "is-unavailable"
                }`}
                aria-label={
                  check.state === "passed"
                    ? "Passed"
                    : check.state === "failed"
                      ? "Failed"
                      : check.state === "review"
                        ? "Review required"
                        : "Unavailable"
                }
              >
                {check.state === "passed" ? (
                  <Icon name="check" width="13" height="13" />
                ) : check.state === "review" ? (
                  "!"
                ) : check.state === "failed" ? (
                  "!"
                ) : (
                  "—"
                )}
              </span>
              <div>
                <span className="proof-label">{check.label}</span>
                <span className="proof-detail">
                  {check.state === "passed"
                    ? "Passed"
                    : check.state === "failed"
                      ? "Failed"
                      : check.state === "review"
                        ? "Review required"
                        : "Unavailable"}{" "}
                  · {check.detail}
                </span>
              </div>
              <span className="proof-index">0{index + 1}</span>
            </li>
          ))}
        </ol>
        <div className={`verdict-result ${verdictClass}`}>
          <Icon name="shield" width="40" height="40" />
          <div>
            <span className="eyebrow">VERDICT</span>
            <strong>{mission.verdict ?? "UNAVAILABLE"}</strong>
          </div>
          <span className="verdict-seal">
            {mission.verdict ? "RECORDED\nVERDICT" : "NO VERDICT\nRECORDED"}
          </span>
        </div>
        <p className="proof-note">
          The saved verdict is reported by PatchVerdict.
          <br />
          AI proposes the patch. Execution earns the verdict.
        </p>
      </div>
    </section>
  );
}
