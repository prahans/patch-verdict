import type { CommandEvidence, MissionResult } from "@/lib/mission-types";

function EvidenceRow({ title, evidence, baseline = false, bugReproducedBeforePatch }: {
  title: string;
  evidence?: CommandEvidence;
  baseline?: boolean;
  bugReproducedBeforePatch?: boolean;
}) {
  if (!evidence) {
    return (
      <div className="evidence-row evidence-summary">
        <div className="evidence-main"><h3 className="evidence-title">{title}</h3><p className="panel-description">This command evidence was not produced or is unavailable in the proof bundle.</p></div>
        <span className="evidence-result is-unavailable">UNAVAILABLE</span>
      </div>
    );
  }
  const passed = evidence.exitCode === 0;
  const expectedFailure = baseline && !passed && bugReproducedBeforePatch === true;
  const result = baseline ? (expectedFailure ? "FAILURE REPRODUCED" : passed ? "NOT REPRODUCED" : "FAILURE UNCONFIRMED") : passed ? "PASS" : "FAIL";
  const resultClass = expectedFailure ? "is-expected" : baseline || !passed ? "is-failure" : "is-pass";

  return (
    <details className={`evidence-row${baseline ? " evidence-row-baseline" : ""}`}>
      <summary className="evidence-summary">
        <svg className="evidence-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="evidence-main">
          <h3 className="evidence-title">{title}</h3>
          <code className="evidence-command">{evidence.command}</code>
        </div>
        <div className="evidence-meta">
          <span className="evidence-duration">{(evidence.durationMs / 1000).toFixed(2)}s</span>
          <span className={`evidence-exit ${resultClass}`}>exit {evidence.exitCode}</span>
          <span className={`evidence-result ${resultClass}`}>{result}</span>
        </div>
      </summary>
      <div className="evidence-logs">
        <div className="evidence-log">
          <h4 className="evidence-log-label">stdout</h4>
          <pre className="evidence-log-output" tabIndex={0} aria-label={`${title} standard output`}><code>{evidence.stdout || "(no output)"}</code></pre>
        </div>
        <div className="evidence-log">
          <h4 className="evidence-log-label">stderr</h4>
          <pre className="evidence-log-output" tabIndex={0} aria-label={`${title} standard error`}><code>{evidence.stderr || "(no output)"}</code></pre>
        </div>
      </div>
    </details>
  );
}

export function VerificationEvidence({ evidence, bugReproducedBeforePatch }: {
  evidence: MissionResult["evidence"];
  bugReproducedBeforePatch?: boolean;
}) {
  return (
    <section className="panel evidence-panel" id="verification-evidence" aria-labelledby="evidence-heading">
      <div className="panel-header">
        <div className="panel-heading">
          <span className="eyebrow">Execution evidence</span>
          <h2 id="evidence-heading">Verification evidence</h2>
          <p className="panel-description">Raw command results. Expand a run to inspect its output.</p>
        </div>
      </div>
      <div className="evidence-list">
        <EvidenceRow title="Baseline reproduction" evidence={evidence?.baselineTest} baseline bugReproducedBeforePatch={bugReproducedBeforePatch} />
        <EvidenceRow title="Post-patch reproduction" evidence={evidence?.postPatchTest} />
        <EvidenceRow title="Full test suite" evidence={evidence?.fullSuite} />
      </div>
      <p className="panel-footer">Baseline labels use the saved reproduction check. Both post-patch checks must pass for verification.</p>
    </section>
  );
}
