import type { MissionDetails, MissionResult } from "@/lib/mission-types";
import { Icon } from "./icon";

const outcomeCopy = {
  TARGET_NOT_REPRODUCED: "The reported behavior could not be reliably reproduced. It may already be fixed, depend on another environment, or affect another branch.",
  UNSTABLE_REPRODUCTION: "Repeated test runs did not establish a stable reproduction. No repair was authorized.",
  UNSUPPORTED_REPOSITORY: "This repository is outside the supported public, single-package JavaScript/TypeScript scope.",
  UNSUPPORTED_REPAIR_SCOPE: "The repair could not be completed within the one-production-file scope.",
  PREPARATION_FAILED: "Repository preparation or test startup did not complete. This is not evidence that the target bug was reproduced.",
  INVESTIGATION_FAILED: "Investigation did not produce a completed, grounded repair diagnosis.",
  PATCH_FAILED: "A supported candidate repair could not be completed.",
  VERIFICATION_FAILED: "Verification did not produce a trustworthy completed repair result.",
  REPAIR_EVALUATED: "The target repair and background suite were evaluated separately.",
} as const;

export function MissionOutcomeNotice({ mission, details }: { mission: MissionResult; details: MissionDetails }) {
  if (!mission.outcome || mission.outcome === "REPAIR_EVALUATED") return null;
  return <section className="panel bundle-notice" aria-label="Mission outcome">
    <p className="eyebrow amber">MISSION OUTCOME</p>
    <h2>{mission.outcome.replaceAll("_", " ")}</h2>
    <p>{outcomeCopy[mission.outcome]}</p>
    {details.source?.targetBranch && <p><strong>{details.source.targetBranch}</strong> @ <code>{details.source.baseCommit.slice(0, 12)}</code></p>}
    {mission.error && <p>{mission.error}</p>}
    {mission.outcome === "TARGET_NOT_REPRODUCED" && <p>Choose another target branch and start a new mission if the issue affects a different release line.</p>}
    <p>No repair verdict was issued. Pull request creation is unavailable.</p>
  </section>;
}

export function ThirdPartyProofChain({ mission }: { mission: MissionResult }) {
  const target = mission.frozenReproduction;
  const repair = mission.repair;
  const suite = mission.suiteComparison;
  const verdictClass = mission.verdict === "VERIFIED" ? "is-verified" : mission.verdict === "REVIEW_REQUIRED" ? "is-review" : mission.verdict === "FAILED" ? "is-failed" : "is-unavailable";
  const checks: { label: string; value: string; state: "passed" | "failed" | "review" | "unavailable" }[] = [
    { label: "Issue-specific target", value: target?.stable ? "Stable failure reproduced" : "No stable target recorded", state: target?.stable ? "passed" : "unavailable" },
    { label: "Frozen test integrity", value: repair ? repair.frozenIntegrity ? "Unchanged after repair" : "Frozen test changed" : target ? "Frozen before repair" : "Unavailable", state: repair ? repair.frozenIntegrity ? "passed" : "failed" : "unavailable" },
    { label: "Production repair scope", value: repair ? `${repair.productionChangedFiles.length} production file(s)` : "No completed repair", state: repair ? repair.scopeValid ? "passed" : "failed" : "unavailable" },
    { label: "Same target after repair", value: mission.checks?.reproductionPassesAfterPatch === true ? "Target passes" : mission.targetAfter ? "Target did not pass" : "Not evaluated", state: mission.checks?.reproductionPassesAfterPatch === true ? "passed" : mission.targetAfter ? "failed" : "unavailable" },
    { label: "Non-target background", value: suite?.state.replaceAll("_", " ") ?? "Not compared", state: !suite ? "unavailable" : suite.state === "CLEAN" ? "passed" : ["REGRESSED", "UNKNOWN", "UNSTABLE"].includes(suite.state) ? "failed" : "review" },
    { label: "Reproduction trust", value: target?.origin === "GENERATED_REGRESSION" ? "AI-generated oracle: human review required" : target ? "Repository-authored test" : "Unavailable", state: target?.origin === "GENERATED_REGRESSION" ? "review" : target ? "passed" : "unavailable" },
  ];
  return <section className="panel proof-panel" aria-labelledby="proof-title">
    <div className="panel-header"><div className="panel-heading"><Icon name="shield" /><h2 id="proof-title">Proof Chain</h2></div><span className="layer-label">TARGET / BACKGROUND</span></div>
    <div className="proof-body"><ol className="proof-list">{checks.map((check, index) => <li key={check.label}>
      <span className={`proof-check ${check.state === "passed" ? "is-verified" : check.state === "review" ? "is-review" : check.state === "failed" ? "is-failed" : "is-unavailable"}`}><Icon name={check.state === "passed" ? "check" : check.state === "review" ? "warning" : check.state === "failed" ? "x" : "minus"} width="13" height="13" /></span>
      <div className="proof-content"><span className="proof-label">{check.label}</span><span className="proof-detail">{check.value}</span></div><span className="proof-index">0{index + 1}</span>
    </li>)}</ol>
      <div className={`verdict-result ${verdictClass}`}><div className="verdict-heading"><Icon name={mission.verdict === "VERIFIED" ? "shield" : mission.verdict === "REVIEW_REQUIRED" ? "warning" : mission.verdict === "FAILED" ? "x" : "minus"} width="40" height="40" /><div className="verdict-title"><span className="eyebrow">VERDICT</span><strong>{mission.verdict ?? "NOT ISSUED"}</strong></div></div></div>
      {mission.verdict === "REVIEW_REQUIRED" && <p className="proof-note">Human review is required before approving this patch.{target?.origin === "GENERATED_REGRESSION" ? " A frozen generated test preserves its bytes; its expected behavior still needs review." : " Stable pre-existing background failures remain part of this repository's evidence."}</p>}
      <p className="proof-note">AI proposes. Tools execute. Tests verify. Humans approve.</p>
    </div>
  </section>;
}

export function ThirdPartyEvidence({ mission }: { mission: MissionResult }) {
  const target = mission.frozenReproduction;
  const suite = mission.suiteComparison;
  const baseline = suite?.baseline ?? mission.backgroundBaseline;
  const isTarget = (item: { testPath: string; testIdentity: string }) => target && item.testPath === target.testPath && item.testIdentity === target.testIdentity;
  const beforeCount = baseline?.failed.filter(item => !isTarget(item)).length;
  const afterCount = suite?.postPatch.failed.filter(item => !isTarget(item)).length;
  return <section className="panel evidence-panel" aria-label="Target and background evidence">
    <div className="panel-header"><div className="panel-heading"><Icon name="shield" /><h2>Target and background evidence</h2></div></div>
    <div className="proof-body">
      <p className="eyebrow amber">REPRODUCTION</p>
      <dl className="mission-facts">
        <div><dt>Source</dt><dd>{target?.origin === "GENERATED_REGRESSION" ? "AI-generated regression" : target ? "Repository-authored test" : "Not established"}</dd></div>
        <div><dt>Framework</dt><dd>{target?.framework === "vitest" ? "Vitest" : target?.framework === "jest" ? "Jest" : "Unavailable"}</dd></div>
        <div><dt>Baseline</dt><dd>{target?.stable ? "TARGET FAILURE REPRODUCED" : "No stable target"}</dd></div>
        <div><dt>Frozen integrity</dt><dd>{mission.repair ? mission.repair.frozenIntegrity ? "Unchanged" : "COMPROMISED" : target ? "Frozen before repair" : "Unavailable"}</dd></div>
      </dl>
      {target && <><p><strong>Test</strong> <code>{target.testPath}</code></p><p><strong>Identity</strong> {target.testIdentity}</p><p><strong>Frozen SHA-256</strong> <code className="base-commit">{target.frozenSha256}</code></p></>}
      {target?.origin === "GENERATED_REGRESSION" && <p className="verdict-explanation">Trust policy: Human review required. Freezing prevents later changes; it does not establish that AI chose the correct expected behavior.</p>}
      <p className="eyebrow amber">REPAIR</p>
      <p>Production file: {mission.repair?.productionChangedFiles.length ? mission.repair.productionChangedFiles.join(", ") : "No completed repair"}</p>
      {mission.repair?.trustedRegressionChangedFiles.length ? <p>Trusted regression changes: {mission.repair.trustedRegressionChangedFiles.join(", ")}</p> : null}
      <p className="eyebrow amber">BACKGROUND SUITE</p>
      <dl className="mission-facts">
        <div><dt>Before</dt><dd>{beforeCount === undefined ? "Unavailable" : `${beforeCount} existing failures`}</dd></div>
        <div><dt>After</dt><dd>{afterCount === undefined ? "Not evaluated" : `${afterCount} background failures`}</dd></div>
        <div><dt>New failures</dt><dd>{suite?.newBackgroundFailures.length ?? "Not evaluated"}</dd></div>
        <div><dt>State</dt><dd>{suite?.state.replaceAll("_", " ") ?? (mission.backgroundBaselineRepeat ? "Baseline repeat recorded" : "Not compared")}</dd></div>
      </dl>
      <p className="proof-note">The selected target is excluded from background comparison. Unrelated failures do not establish reproduction of this issue.</p>
      {suite && [{ label: "Unchanged failures", items: suite.stableBackgroundFailures }, { label: "New failures", items: suite.newBackgroundFailures }, { label: "Resolved failures", items: suite.resolvedBackgroundFailures }].map(group => group.items.length > 0 && <details key={group.label}><summary>{group.label} ({group.items.length})</summary><ul>{group.items.slice(0, 20).map(item => <li key={JSON.stringify(item)}><code>{item.testPath}</code>: {item.testIdentity}</li>)}</ul>{group.items.length > 20 && <p>Showing the first 20 identities. Export evidence for the complete list.</p>}</details>)}
    </div>
  </section>;
}
