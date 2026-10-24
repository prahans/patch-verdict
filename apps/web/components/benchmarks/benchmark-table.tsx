"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/mission/icon";
import {
  formatDuration,
  formatRecordedAt,
  selectBenchmarkRows,
} from "@/lib/benchmarks/presentation";
import type {
  BenchmarkSort,
  BenchmarkVerdictFilter,
} from "@/lib/benchmarks/presentation";
import type { BenchmarkRow } from "@/lib/benchmarks/types";

function CheckResult({
  value,
  baseline = false,
}: {
  value: boolean | null;
  baseline?: boolean;
}) {
  const label =
    value === null
      ? "Unavailable"
      : baseline
        ? value
          ? "Matched"
          : "Not matched"
        : value
          ? "Passed"
          : "Failed";
  const tone =
    value === null
      ? "unavailable"
      : value
        ? baseline
          ? "review"
          : "verified"
        : "failed";
  return (
    <span className={`benchmark-check benchmark-tone-${tone}`}>
      <Icon
        name={value === null ? "minus" : value ? "check" : "x"}
        width="13"
        height="13"
      />
      {label}
    </span>
  );
}

function RecordedFacts({ row }: { row: BenchmarkRow }) {
  return (
    <details className="benchmark-record-facts">
      <summary>Technical Details</summary>
      <dl>
        <div>
          <dt>Mission ID</dt>
          <dd>
            <code>{row.missionId}</code>
          </dd>
        </div>
        <div>
          <dt>Changed files</dt>
          <dd>{row.changedFiles ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Base commit</dt>
          <dd>
            <code>{row.baseCommit ?? "Unavailable"}</code>
          </dd>
        </div>
        <div>
          <dt>Investigation iterations</dt>
          <dd>{row.iterations ?? "Unavailable"}</dd>
        </div>
        <div>
          <dt>Baseline command time</dt>
          <dd>{formatDuration(row.commandDurations.baseline)}</dd>
        </div>
        <div>
          <dt>Post-repair command time</dt>
          <dd>{formatDuration(row.commandDurations.postPatch)}</dd>
        </div>
        <div>
          <dt>Repository test script time</dt>
          <dd>{formatDuration(row.commandDurations.fullSuite)}</dd>
        </div>
        <div>
          <dt>Overall mission duration</dt>
          <dd>{formatDuration(row.missionDurationMs)}</dd>
        </div>
      </dl>
    </details>
  );
}

export function BenchmarkTable({
  rows,
  cohort = "benchmarks",
}: {
  rows: BenchmarkRow[];
  cohort?: "benchmarks" | "recorded";
}) {
  const [search, setSearch] = useState("");
  const [verdict, setVerdict] = useState<BenchmarkVerdictFilter>("all");
  const [sort, setSort] = useState<BenchmarkSort>(
    cohort === "recorded" ? "recorded-desc" : "scenario-asc",
  );
  const filteredRows = selectBenchmarkRows(rows, { search, verdict, sort });
  const hasFilters = search !== "" || verdict !== "all";

  return (
    <div className="benchmark-table-content">
      <div className="benchmark-table-controls">
        <div className="benchmark-search">
          <label htmlFor={`${cohort}-search`}>
            Search scenario, repository, or mission ID
          </label>
          <input
            id={`${cohort}-search`}
            type="search"
            placeholder="Find a scenario, repository, or mission…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`${cohort}-verdict`}>Repair Verdict</label>
          <select
            id={`${cohort}-verdict`}
            value={verdict}
            onChange={(event) =>
              setVerdict(event.target.value as BenchmarkVerdictFilter)
            }
          >
            <option value="all">All verdicts</option>
            <option value="VERIFIED">VERIFIED</option>
            <option value="REVIEW_REQUIRED">REVIEW_REQUIRED</option>
            <option value="FAILED">FAILED</option>
            <option value="none">No Verdict Recorded</option>
          </select>
        </div>
        <div>
          <label htmlFor={`${cohort}-sort`}>Sort by</label>
          <select
            id={`${cohort}-sort`}
            value={sort}
            onChange={(event) => setSort(event.target.value as BenchmarkSort)}
          >
            <option value="recorded-desc">Recorded · newest first</option>
            <option value="recorded-asc">Recorded · oldest first</option>
            <option value="scenario-asc">Scenario · A–Z</option>
            <option value="scenario-desc">Scenario · Z–A</option>
            <option value="duration-asc">Recorded test time · shortest</option>
            <option value="duration-desc">Recorded test time · longest</option>
            <option value="verdict-asc">Verdict · verified first</option>
          </select>
        </div>
      </div>
      <div className="benchmark-table-status">
        <p role="status">
          Showing {filteredRows.length} of {rows.length}{" "}
          {cohort === "benchmarks"
            ? "selected scenarios"
            : "recorded missions"}
        </p>
        {hasFilters && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setVerdict("all");
            }}
          >
            Clear filters
          </button>
        )}
        <span>Execution status and repair verdict are separate; failed execution may have no verdict</span>
      </div>
      {filteredRows.length === 0 ? (
        <div className="benchmark-no-matches">
          <Icon name="file" width="25" height="25" />
          <h3>
            {rows.length === 0
              ? "No recorded missions to display"
              : "No matching results"}
          </h3>
          <p>
            {rows.length === 0
              ? "Saved proof bundles appear here when discovered."
              : "Try another scenario, repository, mission ID, or verdict filter."}
          </p>
        </div>
      ) : (
        <div
          className="benchmark-table-scroll"
          role="region"
          aria-label={
            cohort === "benchmarks"
              ? "Controlled benchmark results"
              : "Recorded mission history"
          }
          tabIndex={0}
        >
          <table className="benchmark-table">
            <caption className="benchmark-sr-only">
              {cohort === "benchmarks"
                ? "Selected controlled scenarios and available evidence"
                : "Saved mission attempts and unavailable records; new runs do not change benchmark totals"}
              . Baseline Match means the configured failure expectations were met.
              Recorded test time sums available baseline, post-repair, and
              repository test script durations.
            </caption>
            <thead>
              <tr>
                <th scope="col">Scenario / Repository</th>
                <th scope="col">Execution Status</th>
                <th scope="col">Repair Verdict</th>
                <th scope="col">Baseline Match</th>
                <th scope="col">Post-Repair Check</th>
                <th scope="col">Repository Tests</th>
                <th scope="col">Integrity Status</th>
                <th scope="col">Recorded Test Time</th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => {
                const verdictTone =
                  row.verdict === "VERIFIED"
                    ? "verified"
                    : row.verdict === "REVIEW_REQUIRED"
                      ? "review"
                      : row.verdict === "FAILED"
                        ? "failed"
                        : "unavailable";
                const integrityTone =
                  row.integrity === "PRESERVED"
                    ? "verified"
                    : row.integrity === "REVIEW_REQUIRED"
                      ? "review"
                      : row.integrity === "COMPROMISED"
                        ? "failed"
                        : "unavailable";
                return (
                  <tr key={row.id}>
                    <th scope="row" className="benchmark-scenario-cell">
                      <span className="benchmark-scenario-name">
                        {row.scenario}
                      </span>
                      <span className="benchmark-repository">
                        {row.repository ?? "Unavailable"}
                      </span>
                      {cohort === "recorded" && (
                        <span className="benchmark-mission-id">
                          {row.missionId}
                        </span>
                      )}
                      <span className="benchmark-recorded-at">
                        {row.recordedAtSource === "artifact"
                          ? "Artifact saved: "
                          : "Recorded: "}
                        {row.recordedAt ? (
                          <time dateTime={row.recordedAt}>
                            {formatRecordedAt(row.recordedAt)}
                          </time>
                        ) : (
                          "Unavailable"
                        )}
                      </span>
                      {row.unavailableReason && (
                        <p className="benchmark-row-notice">
                          {row.unavailableReason}
                        </p>
                      )}
                      {row.evidenceWarnings && (
                        <p className="benchmark-row-notice">
                          Some supporting artifacts are unavailable.
                        </p>
                      )}
                      <RecordedFacts row={row} />
                    </th>
                    <td>
                      <span
                        className={`benchmark-execution${row.executionStatus === "FAILED" ? " benchmark-tone-failed" : ""}`}
                      >
                        {row.executionStatus ?? "Unavailable"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`benchmark-badge benchmark-tone-${verdictTone}`}
                      >
                        {row.verdict ?? "No Verdict Recorded"}
                      </span>
                    </td>
                    <td>
                      <CheckResult value={row.baselineReproduced} baseline />
                    </td>
                    <td>
                      <CheckResult value={row.postPatchPassed} />
                    </td>
                    <td>
                      <CheckResult value={row.fullSuitePassed} />
                    </td>
                    <td>
                      <span
                        className={`benchmark-integrity benchmark-tone-${integrityTone}`}
                      >
                        {row.integrity ?? "Unavailable"}
                      </span>
                    </td>
                    <td>
                      <span className="benchmark-row-duration">
                        {formatDuration(row.testDurationMs)}
                      </span>
                      <span className="benchmark-duration-coverage">
                        {row.timedCommandCount}/3 command durations
                      </span>
                    </td>
                    <td>
                      {row.availability === "valid" && row.evidenceUrl ? (
                        <Link
                          prefetch={false}
                          className="benchmark-evidence-link"
                          href={row.evidenceUrl}
                          aria-label={`View Evidence for ${row.scenario}`}
                        >
                          View Evidence <span aria-hidden="true">↗</span>
                        </Link>
                      ) : (
                        <span className="benchmark-tone-unavailable">
                          Unavailable
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="benchmark-table-footnote">
        Baseline Match checks configured failure expectations, not the cause of
        failure. PRESERVED means no recognized integrity concerns were detected.
        Recorded test time sums available command durations (up to 3 per
        mission). Partial timing is shown as recorded. Overall mission duration
        is listed separately in Technical Details when available.
      </p>
    </div>
  );
}
