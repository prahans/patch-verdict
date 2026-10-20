import { formatDuration, formatRate } from "@/lib/benchmarks/presentation";
import type { BenchmarkSummary as Summary } from "@/lib/benchmarks/types";

export function BenchmarkSummary({ summary }: { summary: Summary }) {
  const metrics = [
    { label: "Configured benchmark scenarios", value: summary.configured, note: "Explicitly selected in the catalog", tone: "neutral" },
    { label: "Valid recorded evidence", value: summary.valid, note: `${summary.valid} of ${summary.configured} configured scenarios`, tone: "neutral" },
    { label: "VERIFIED", value: summary.verified, note: "Recorded verification verdict", tone: "verified" },
    { label: "REVIEW_REQUIRED", value: summary.reviewRequired, note: "Recorded verdict requires human review", tone: "review" },
    { label: "FAILED", value: summary.failed, note: "Recorded repair verdict", tone: "failed" },
    { label: "No-verdict / unavailable", value: summary.noVerdict, note: `${summary.validWithoutVerdict} without a verdict · ${summary.unavailable} unavailable`, tone: "neutral" },
    { label: "Controlled benchmark verification rate", value: formatRate(summary.verificationRate), note: `${summary.verified} VERIFIED / ${summary.configured} configured scenarios`, tone: "rate" },
    { label: "Measured test execution", value: formatDuration(summary.testDurationMs), note: `${summary.timedCommandCount} saved commands across ${summary.timedMissionCount} scenarios`, tone: "neutral" },
  ];

  return (
    <section aria-labelledby="benchmark-summary-title" className="benchmark-overview">
      <div className="benchmark-section-kicker">
        <h2 id="benchmark-summary-title">Cohort overview</h2>
        <span>All configured scenarios · unaffected by filters</span>
      </div>
      <dl className="benchmark-metrics">
        {metrics.map((metric) => (
          <div className={`benchmark-metric benchmark-metric-${metric.tone}`} key={metric.label}>
            <dt>{metric.label}</dt>
            <dd className={metric.value === "Unavailable" ? "benchmark-value-unavailable" : undefined}>{metric.value}</dd>
            <div className="benchmark-metric-note">{metric.note}</div>
          </div>
        ))}
      </dl>
    </section>
  );
}
