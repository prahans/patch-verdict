import Link from "next/link";
import { Icon } from "@/components/mission/icon";
import type { BenchmarkDashboardData } from "@/lib/benchmarks/types";
import { BenchmarkSummary } from "./benchmark-summary";
import { VerdictDistribution } from "./verdict-distribution";
import { BenchmarkTable } from "./benchmark-table";
import { BenchmarkRefresh } from "./benchmark-refresh";

export function BenchmarkDashboard({ data }: { data: BenchmarkDashboardData }) {
  return (
    <>
      <BenchmarkRefresh />
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
              Every result backed by recorded evidence.
            </p>
            <h1 id="benchmark-title">Benchmark Dashboard</h1>
            <p className="benchmark-subtitle">
              Explore how PatchVerdict investigated, repaired, and verified bugs
              across controlled test repositories.
            </p>
          </div>
          <span className="benchmark-read-only">
            <Icon name="shield" width="14" height="14" /> READ-ONLY EVIDENCE
          </span>
        </section>
        <p className="benchmark-scope-note">
          <Icon name="warning" width="15" height="15" />
          Results reflect selected controlled test scenarios, not general-purpose
          repair accuracy.
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
              <p className="eyebrow">Selected test scenarios</p>
              <h2 id="benchmark-results-title">Controlled Benchmarks</h2>
              <p>
                These results are linked to specific completed runs. New attempts
                do not change the selected benchmark results.
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
              <h3>Your controlled benchmarks start here</h3>
              <p>
                No benchmark scenarios are configured. Register your saved
                missions to show their recorded outcomes.
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

        <section
          className="panel benchmark-other"
          aria-labelledby="recorded-missions-title"
        >
          <div className="benchmark-results-heading">
            <div>
              <p className="eyebrow">Saved attempt history</p>
              <h2 id="recorded-missions-title">Recorded Mission History</h2>
              <p>
                Browse saved mission attempts, including successful repairs,
                unsuccessful attempts, and results requiring human review.
              </p>
            </div>
            <span className="benchmark-count-label">
              {data.recordedMissions.length} missions
            </span>
          </div>
          <div className="benchmark-other-intro">
            New completed missions appear automatically while this page is open.
            Benchmark totals remain based on the{" "}
            {data.summary.configured === 7 ? "seven" : data.summary.configured}{" "}
            selected runs. Refreshes every 30 seconds while this page is visible.
            Multiple runs for a repository remain separate records.
          </div>
          <div className="benchmark-other-intro">
            History shows up to 100 saved attempts from a scan of up to 500
            directory entries and may be incomplete. Active filters can hide
            results.
          </div>
          <BenchmarkTable rows={data.recordedMissions} cohort="recorded" />
        </section>

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
