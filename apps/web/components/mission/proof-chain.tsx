import type { MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";

export function ProofChain({ mission }: { mission: MissionResult }) {
  const checks = [
    {
      label: "Bug reproduced before patch",
      passed: mission.checks?.bugReproducedBeforePatch,
      detail: mission.evidence?.baselineTest
        ? `Baseline · exit ${mission.evidence.baselineTest.exitCode}`
        : "Baseline evidence unavailable",
    },
    {
      label: "Candidate patch applied",
      passed: mission.patch?.applied,
      detail: mission.patch
        ? `${mission.patch.changedFiles.length} ${mission.patch.changedFiles.length === 1 ? "file" : "files"} changed`
        : "Patch metadata unavailable",
    },
    {
      label: "Git diff captured",
      passed:
        mission.patch?.diff === undefined
          ? undefined
          : Boolean(mission.patch.diff.trim()),
      detail: mission.patch?.baseCommit
        ? `Against ${mission.patch.baseCommit.slice(0, 7)}`
        : "Base commit unavailable",
    },
    {
      label: "Reproduction passes after patch",
      passed: mission.checks?.reproductionPassesAfterPatch,
      detail: mission.evidence?.postPatchTest
        ? `Targeted test · exit ${mission.evidence.postPatchTest.exitCode}`
        : "Post-patch evidence unavailable",
    },
    {
      label: "Full test suite passes",
      passed: mission.checks?.fullSuitePassesAfterPatch,
      detail: mission.evidence?.fullSuite
        ? `Full suite · exit ${mission.evidence.fullSuite.exitCode}`
        : "Full suite evidence unavailable",
    },
  ];
  const passedCount = checks.filter((check) => check.passed).length;
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
          <span className={passedCount === checks.length ? "green" : "amber"}>
            {passedCount}/{checks.length} satisfied
          </span>
        </div>
        <ol className="proof-list">
          {checks.map((check, index) => (
            <li key={check.label}>
              <span
                className={`proof-check ${check.passed === true ? "green" : check.passed === false ? "is-failed" : "is-unavailable"}`}
                aria-label={
                  check.passed === true
                    ? "Passed"
                    : check.passed === false
                      ? "Failed"
                      : "Unavailable"
                }
              >
                {check.passed === true ? (
                  <Icon name="check" width="13" height="13" />
                ) : check.passed === false ? (
                  "!"
                ) : (
                  "—"
                )}
              </span>
              <div>
                <span className="proof-label">{check.label}</span>
                <span className="proof-detail">
                  {check.passed === true
                    ? "Passed"
                    : check.passed === false
                      ? "Failed"
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
