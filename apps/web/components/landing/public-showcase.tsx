import Link from "next/link";
import { Icon } from "@/components/mission/icon";

/** Presentation-only: API access is controlled by the existing host policy. */
export function PublicShowcase() {
  return (
    <section
      id="showcase"
      className="launch-panel"
      aria-labelledby="showcase-title"
      tabIndex={-1}
    >
      <div className="launch-panel-header">
        <p className="eyebrow amber">
          <Icon name="shield" width="14" height="14" /> RECORDED EVIDENCE
        </p>
        <h2 id="showcase-title">Explore PatchVerdict</h2>
        <p>
          Browse selected controlled missions and inspect the evidence behind
          their recorded verdicts. This public page is a showcase, not a place
          to submit new verification missions.
        </p>
      </div>
      <div className="launch-form">
        <div className="launch-fields">
          <div className="evidence-artifact-list" aria-label="Available evidence views">
            <span><Icon name="activity" width="14" height="14" /> Flight Recorder</span>
            <span><Icon name="file" width="14" height="14" /> AI investigation</span>
            <span><Icon name="branch" width="14" height="14" /> Candidate diff</span>
            <span><Icon name="shield" width="14" height="14" /> Verification evidence</span>
          </div>
          <p className="launch-hint">
            Start with the benchmark dashboard, then open a saved mission to
            inspect its available reports, tests, and verdict. Missing saved
            evidence is clearly labeled.
          </p>
          <Link className="landing-button launch-submit" href="/benchmarks" prefetch={false}>
            Explore Benchmark Results <span aria-hidden="true">↗</span>
          </Link>
        </div>
        <p className="launch-footnote">
          Viewing saved evidence does not launch a new AI mission.
        </p>
      </div>
    </section>
  );
}
