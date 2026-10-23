import Link from "next/link";
import { Icon } from "@/components/mission/icon";

export function Hero({ proofExampleId }: { proofExampleId: string | null }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <p className="eyebrow amber hero-eyebrow"><span className="status-dot" /> AI PATCH VERIFICATION</p>
      <h1 id="hero-title">Don&apos;t trust<br />the patch.<br /><span>Inspect the evidence.</span></h1>
      <p className="hero-description">
        PatchVerdict uses AI to investigate a reported bug and attempt a candidate
        repair. It runs the configured reproduction and repository test script,
        records the Git diff, and calculates a verdict when verification completes.
      </p>
      <div className="hero-actions">
        <a className="landing-button" href="#verify">Start verification <span aria-hidden="true">↗</span></a>
        {proofExampleId && (
          <Link className="landing-text-link" href={`/missions/${proofExampleId}`} prefetch={false}>
            View saved evidence <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      <div className="hero-principle">
        <Icon name="shield" width="19" height="19" />
        <p>AI reasoning is not proof.<br /><strong>Recorded checks determine the verdict.</strong></p>
      </div>
    </section>
  );
}
