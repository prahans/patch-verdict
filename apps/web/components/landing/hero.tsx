import Link from "next/link";
import { Icon } from "@/components/mission/icon";

export function Hero({ proofExampleId }: { proofExampleId: string | null }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <p className="eyebrow amber hero-eyebrow"><span className="status-dot" /> AI PATCH VERIFICATION</p>
      <h1 id="hero-title">Don&apos;t trust<br />the patch.<br /><span>Verify the evidence.</span></h1>
      <p className="hero-description">
        PatchVerdict reproduces the reported bug, lets an AI agent investigate and
        propose a bounded repair, reruns trusted tests, captures the exact Git diff,
        and produces a deterministic verdict.
      </p>
      <div className="hero-actions">
        <a className="landing-button" href="#verify">Verify a patch <span aria-hidden="true">↗</span></a>
        {proofExampleId && (
          <Link className="landing-text-link" href={`/missions/${proofExampleId}`} prefetch={false}>
            View proof example <span aria-hidden="true">→</span>
          </Link>
        )}
      </div>
      <div className="hero-principle">
        <Icon name="shield" width="19" height="19" />
        <p>AI reasoning is a hypothesis.<br /><strong>Tool evidence is authoritative.</strong></p>
      </div>
    </section>
  );
}
