import { formatRate } from "@/lib/benchmarks/presentation";
import type { BenchmarkSummary } from "@/lib/benchmarks/types";

export function VerdictDistribution({ summary }: { summary: BenchmarkSummary }) {
  const segments = [
    { label: "VERIFIED", count: summary.verified, tone: "verified" },
    { label: "REVIEW_REQUIRED", count: summary.reviewRequired, tone: "review" },
    { label: "FAILED", count: summary.failed, tone: "failed" },
    { label: "No recorded verdict", count: summary.noVerdict, tone: "unavailable" },
  ];

  return (
    <section className="panel benchmark-distribution" aria-labelledby="benchmark-distribution-title">
      <div className="benchmark-distribution-main">
        <div className="benchmark-panel-heading">
          <h2 id="benchmark-distribution-title">Verdict distribution</h2>
          <span>{summary.configured} configured</span>
        </div>
        <div className="benchmark-distribution-bar" role="img" aria-label={summary.configured === 0
          ? "Verdict distribution unavailable: no benchmark scenarios configured."
          : `Verdict distribution across ${summary.configured} configured scenarios: ${segments.map((segment) => `${segment.count} ${segment.label}`).join(", ")}.`}>
          {summary.configured > 0 && segments.filter((segment) => segment.count > 0).map((segment) => (
            <span key={segment.label} className={`benchmark-segment-${segment.tone}`} style={{ width: `${segment.count / summary.configured * 100}%` }} />
          ))}
        </div>
        <ul className="benchmark-distribution-legend" aria-label="Recorded verdict counts">
          {segments.map((segment) => (
            <li key={segment.label}>
              <span className={`benchmark-legend-dot benchmark-segment-${segment.tone}`} aria-hidden="true" />
              <span>{segment.label}</span>
              <strong>{segment.count}</strong>
              <span className="benchmark-legend-rate">{formatRate(summary.configured ? segment.count / summary.configured * 100 : null)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="benchmark-methodology">
        <p className="eyebrow">Reading the evidence</p>
        <h3>One selected mission per scenario.</h3>
        <p>The verification rate is VERIFIED divided by all configured scenarios. Missing evidence and missions without a verdict remain in that denominator.</p>
        <p>Durations add available saved test commands. They do not measure total AI mission runtime.</p>
      </div>
    </section>
  );
}
