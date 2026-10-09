import Link from "next/link";
import { Icon } from "@/components/mission/icon";

export function EvidencePreview({ proofExampleId }: { proofExampleId: string | null }) {
  return (
    <section id="evidence" className="landing-section evidence-section" aria-labelledby="evidence-title">
      <div className="evidence-intro">
        <p className="eyebrow amber">03 / THE EVIDENCE</p>
        <h2 id="evidence-title">A verdict you<br />can inspect.</h2>
        <p>Every verdict is backed by a saved proof bundle.</p>
        <p>Follow the baseline failure, inspected files, exact Git diff, and verification results in one mission record.</p>
        <div className="evidence-artifact-list" aria-label="Saved proof artifacts">
          <span><Icon name="file" width="14" height="14" /> proof.json</span>
          <span><Icon name="activity" width="14" height="14" /> events.json</span>
          <span><Icon name="branch" width="14" height="14" /> patch.diff</span>
          <span><Icon name="file" width="14" height="14" /> investigation.md</span>
        </div>
        {proofExampleId && <Link className="landing-text-link" href={`/missions/${proofExampleId}`} prefetch={false}>Open saved proof example <span aria-hidden="true">→</span></Link>}
      </div>
      <div className="evidence-preview panel" aria-label="Illustrative proof preview, not a live mission">
        <div className="panel-header">
          <div className="panel-heading"><Icon name="terminal" /><h3>Verification record</h3></div>
          <span className="example-proof-label">EXAMPLE PROOF</span>
        </div>
        <p className="example-proof-caption">Illustrative arithmetic fix · not a live mission</p>
        <div className="preview-record">
          <span className="preview-index">01</span>
          <div className="preview-record-main"><h4>Baseline reproduction</h4><code>npm test</code></div>
          <span className="preview-exit amber">exit 1</span>
          <span className="preview-status amber">FAILURE REPRODUCED</span>
        </div>
        <div className="preview-record">
          <span className="preview-index">02</span>
          <div className="preview-record-main"><h4>Investigation</h4><div className="preview-files"><code>src/average.js</code><code>src/average.test.js</code></div></div>
          <span className="preview-status text-muted">REPOSITORY EVIDENCE</span>
        </div>
        <div className="preview-diff">
          <div className="preview-diff-heading"><span className="preview-index">03</span><span><Icon name="branch" width="13" height="13" /> Candidate diff</span><code>src/average.js</code></div>
          <pre aria-label="Candidate patch example"><code><span className="preview-removed">- return sum + numbers.length;</span><span className="preview-added">+ return sum / numbers.length;</span></code></pre>
        </div>
        <div className="preview-record">
          <span className="preview-index">04</span>
          <div className="preview-record-main"><h4>Post-patch reproduction</h4><code>npm test</code></div>
          <span className="preview-exit green">exit 0</span>
          <span className="preview-status green"><Icon name="check" width="13" height="13" /> PASSED</span>
        </div>
        <div className="preview-record">
          <span className="preview-index">05</span>
          <div className="preview-record-main"><h4>Full suite</h4><code>npm test</code></div>
          <span className="preview-exit green">exit 0</span>
          <span className="preview-status green"><Icon name="check" width="13" height="13" /> PASSED</span>
        </div>
        <div className="preview-record">
          <span className="preview-index">06</span>
          <div className="preview-record-main"><h4>Verification integrity</h4></div>
          <span className="preview-status green"><Icon name="shield" width="13" height="13" /> PRESERVED</span>
        </div>
        <div className="preview-verdict">
          <Icon name="shield" width="30" height="30" />
          <div><span className="eyebrow">FINAL VERDICT</span><strong>VERIFIED</strong></div>
          <span className="preview-verdict-note">TESTS + GIT EVIDENCE<br />DETERMINISTIC RESULT</span>
        </div>
      </div>
    </section>
  );
}
