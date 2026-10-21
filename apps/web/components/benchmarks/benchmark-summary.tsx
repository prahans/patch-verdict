import { formatDuration, formatRate } from "@/lib/benchmarks/presentation";
import type { BenchmarkSummary as Summary } from "@/lib/benchmarks/types";

export function BenchmarkSummary({ summary }: { summary: Summary }) {
  const metrics = [
    {
      label: "Selected Test Scenarios",
      value: summary.configured,
      note: "One selected run per scenario",
      tone: "neutral",
    },
    {
      label: "Readable Proof Bundles",
      value: summary.valid,
      note: `${summary.valid} of ${summary.configured} selected scenarios have valid, matching evidence`,
      tone: "neutral",
    },
    {
      label: "VERIFIED",
      value: summary.verified,
      note: "The bug was reproduced, the patch was applied, and the required tests passed without detected verification-integrity violations.",
      tone: "verified",
    },
    {
      label: "REVIEW_REQUIRED",
      value: summary.reviewRequired,
      note: "The repair requires human inspection because it changed verification-related files or triggered an integrity review flag.",
      tone: "review",
    },
    {
      label: "FAILED",
      value: summary.failed,
      note: "The completed verification process did not meet the requirements for an approved repair.",
      tone: "failed",
    },
    {
      label: "No Decision / Missing Evidence",
      value: summary.noVerdict,
      note: `${summary.validWithoutVerdict} without a verdict · ${summary.unavailable} unavailable`,
      tone: "neutral",
    },
    {
      label: "Verified Outcomes",
      value: formatRate(summary.verificationRate),
      note: `${summary.verified} VERIFIED / ${summary.configured} selected scenarios`,
      tone: "rate",
    },
    {
      label: "Recorded Test Execution Time",
      value: formatDuration(summary.testDurationMs),
      note: `${summary.timedCommandCount} saved commands across ${summary.timedMissionCount} scenarios`,
      tone: "neutral",
    },
  ];

  return (
    <section
      aria-labelledby="benchmark-summary-title"
      className="benchmark-overview"
    >
      <div className="benchmark-section-kicker">
        <h2 id="benchmark-summary-title">Benchmark Overview</h2>
        <span>All selected scenarios · unaffected by filters</span>
      </div>
      <dl className="benchmark-metrics">
        {metrics.map((metric) => (
          <div
            className={`benchmark-metric benchmark-metric-${metric.tone}`}
            key={metric.label}
          >
            <dt>{metric.label}</dt>
            <dd
              className={
                metric.value === "Unavailable"
                  ? "benchmark-value-unavailable"
                  : undefined
              }
            >
              {metric.value}
            </dd>
            <div className="benchmark-metric-note">{metric.note}</div>
          </div>
        ))}
      </dl>
    </section>
  );
}
