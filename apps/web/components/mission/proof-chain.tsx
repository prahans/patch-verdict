import type { MissionResult } from "@/lib/mock-mission";
import { Icon } from "./icon";

export function ProofChain({ mission }: { mission: MissionResult }) {
  const checks = [
    { label: "Bug reproduced before patch", passed: mission.checks?.bugReproducedBeforePatch === true, detail: `Baseline · exit ${mission.evidence?.baselineTest.exitCode ?? "unknown"}` },
    { label: "Candidate patch applied", passed: mission.patch?.applied === true, detail: `${mission.patch?.changedFiles.length ?? 0} file changed` },
    { label: "Git diff captured", passed: Boolean(mission.patch?.diff.trim()), detail: `Against ${mission.patch?.baseCommit.slice(0, 7) ?? "unknown"}` },
    { label: "Reproduction passes after patch", passed: mission.checks?.reproductionPassesAfterPatch === true, detail: `Targeted test · exit ${mission.evidence?.postPatchTest.exitCode ?? "unknown"}` },
    { label: "Full test suite passes", passed: mission.checks?.fullSuitePassesAfterPatch === true, detail: `Full suite · exit ${mission.evidence?.fullSuite.exitCode ?? "unknown"}` },
  ];
  const passedCount = checks.filter((check) => check.passed).length;
  // Display the recorded result; verdict calculation belongs to the engine.
  const verified = mission.verdict === "VERIFIED";

  return (
    <section className="panel proof-panel" aria-labelledby="proof-title">
      <div className="panel-header">
        <div className="panel-heading"><Icon name="shield" /><h2 id="proof-title">Proof Chain</h2></div>
        <span className="layer-label">DETERMINISTIC</span>
      </div>
      <div className="proof-body">
        <div className="proof-count"><span>Evidence requirements</span><span className={passedCount === checks.length ? "green" : "amber"}>{passedCount}/{checks.length} satisfied</span></div>
        <ol className="proof-list">
          {checks.map((check, index) => (
            <li key={check.label}>
              <span className={`proof-check ${check.passed ? "green" : "amber"}`} aria-label={check.passed ? "Passed" : "Not satisfied"}>{check.passed ? <Icon name="check" width="13" height="13" /> : "!"}</span>
              <div><span className="proof-label">{check.label}</span><span className="proof-detail">{check.detail}</span></div>
              <span className="proof-index">0{index + 1}</span>
            </li>
          ))}
        </ol>
        <div className={`verdict-result ${verified ? "is-verified" : "is-failed"}`}>
          <Icon name="shield" width="40" height="40" />
          <div><span className="eyebrow">VERDICT</span><strong>{mission.verdict ?? "PENDING"}</strong></div>
          <span className="verdict-seal">{verified ? "ALL CHECKS\nPASSED" : "REVIEW\nREQUIRED"}</span>
        </div>
        <p className="proof-note">Derived from test results and Git evidence.<br />AI proposes the patch. Execution earns the verdict.</p>
      </div>
    </section>
  );
}
