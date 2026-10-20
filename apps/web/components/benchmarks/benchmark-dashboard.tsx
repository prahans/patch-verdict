import Link from "next/link";
import { Icon } from "@/components/mission/icon";
import type { BenchmarkDashboardData } from "@/lib/benchmarks/types";
import { BenchmarkSummary } from "./benchmark-summary";
import { VerdictDistribution } from "./verdict-distribution";
import { BenchmarkTable } from "./benchmark-table";

export function BenchmarkDashboard({ data }: { data: BenchmarkDashboardData }) {
  return (
    <>
      <a className="skip-link" href="#benchmarks">
        Skip to benchmarks
      </a>
      <header className="site-header benchmark-header">
        <div className="header-inner">
          <div className="brand-group">
            <Link href="/" className="brand" aria-label="PatchVerdict home">
              <span className="brand-symbol">
                <Icon name="shield" width="25" height="25" />
              </span>
              <span>
                PATCH<span className="brand-secondary">VERDICT</span>
                <span className="brand-period">.</span>
              </span>
            </Link>
            <span className="brand-tagline">
              Every patch earns its verdict.
            </span>
          </div>
          <nav className="benchmark-header-nav" aria-label="Main navigation">
            <Link href="/benchmarks" aria-current="page">
              Benchmarks
            </Link>
            <Link href="/#verify">
              Verify a patch <span aria-hidden="true">↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <main id="benchmarks" className="benchmark-shell">
        <div className="benchmark-workspace-bar">
          <span>
            <Icon name="activity" width="15" height="15" /> Evidence /
            Benchmarks
          </span>
          <span>
            <Icon name="file" width="13" height="13" /> Saved proof bundles
          </span>
        </div>
        <section
          className="benchmark-heading"
          aria-labelledby="benchmark-title"
        >
          <div>
            <p className="eyebrow amber">
              Recorded outcomes. Inspectable evidence.
            </p>
            <h1 id="benchmark-title">Benchmark Dashboard</h1>
            <p className="benchmark-subtitle">
              Measured outcomes from recorded PatchVerdict verification
              missions.
            </p>
          </div>
          <span className="benchmark-read-only">
            <Icon name="shield" width="14" height="14" /> READ-ONLY EVIDENCE
          </span>
        </section>
        <p className="benchmark-scope-note">
          <Icon name="warning" width="15" height="15" />
          Controlled benchmark results. Not a measure of general-purpose repair
          accuracy.
        </p>

        {data.notices.length > 0 && (
          <aside
            className="benchmark-notices"
            aria-label="Evidence availability"
          >
            <Icon name="file" width="17" height="17" />
            <div>
              <h2>Evidence availability</h2>
              <ul>
                {data.notices.map((notice, index) => (
                  <li key={`${index}-${notice}`}>{notice}</li>
                ))}
              </ul>
            </div>
          </aside>
        )}

        <BenchmarkSummary summary={data.summary} />
        <VerdictDistribution summary={data.summary} />

        <section
          className="panel benchmark-results"
          aria-labelledby="benchmark-results-title"
        >
          <div className="benchmark-results-heading">
            <div>
              <p className="eyebrow">Controlled cohort</p>
              <h2 id="benchmark-results-title">Benchmark results</h2>
              <p>
                Exact selected missions, with their recorded verdicts and
                verification checks.
              </p>
            </div>
            <span className="benchmark-count-label">
              {data.summary.configured} scenarios
            </span>
          </div>
          {data.benchmarks.length === 0 ? (
            <div className="benchmark-setup">
              <div className="benchmark-setup-icon">
                <Icon name="branch" width="28" height="28" />
              </div>
              <h3>Your controlled cohort starts here</h3>
              <p>
                No benchmark scenarios are configured. Register your saved
                missions to show their measured outcomes.
              </p>
              <ol>
                <li>
                  <span>01</span>
                  <div>
                    <strong>Select your scenarios</strong>
                    <p>
                      Choose one finalized mission for each controlled scenario.
                    </p>
                  </div>
                </li>
                <li>
                  <span>02</span>
                  <div>
                    <strong>Register the evidence</strong>
                    <p>
                      Add its scenario ID, name, expected repository and exact
                      mission ID to{" "}
                      <code>apps/web/lib/benchmarks/catalog.ts</code>.
                    </p>
                  </div>
                </li>
                <li>
                  <span>03</span>
                  <div>
                    <strong>Reload this dashboard</strong>
                    <p>
                      The saved proof is validated and its repository matched
                      before it counts as evidence.
                    </p>
                  </div>
                </li>
              </ol>
              <p className="benchmark-setup-docs">
                Setup and metric definitions:{" "}
                <code>docs/BENCHMARK_DASHBOARD.md</code>
              </p>
            </div>
          ) : (
            <BenchmarkTable rows={data.benchmarks} cohort="benchmarks" />
          )}
        </section>

        <details className="panel benchmark-other">
          <summary>
            <span className="benchmark-other-chevron" aria-hidden="true">
              ›
            </span>
            <span>
              <strong>Other locally recorded missions</strong>
              <span>Excluded from all controlled benchmark metrics</span>
            </span>
            <span className="benchmark-count-label">
              {data.otherMissions.length} missions
            </span>
          </summary>
          <div className="benchmark-other-intro">
            These finalized local records are not selected in the benchmark
            catalog. Multiple runs for a repository remain separate records.
          </div>
          <BenchmarkTable rows={data.otherMissions} cohort="other" />
        </details>

        <footer className="benchmark-footer">
          <p>
            <span className="footer-mark">PV</span> AI proposes. Tools execute.
            Tests verify. Humans approve.
          </p>
          <span>RECORDED EVIDENCE · CONTROLLED SCOPE</span>
        </footer>
      </main>
    </>
  );
}
