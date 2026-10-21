import type { BenchmarkRow, RecordedVerdict } from "./types";

export type BenchmarkVerdictFilter = "all" | RecordedVerdict | "none";
export type BenchmarkSort =
  | "scenario-asc"
  | "scenario-desc"
  | "recorded-desc"
  | "recorded-asc"
  | "duration-asc"
  | "duration-desc"
  | "verdict-asc";

export function formatDuration(milliseconds: number | null): string {
  if (
    milliseconds === null ||
    !Number.isFinite(milliseconds) ||
    milliseconds < 0
  )
    return "Unavailable";
  if (milliseconds < 1_000) return `${Number(milliseconds.toFixed(2))} ms`;
  if (milliseconds < 60_000)
    return `${Number((milliseconds / 1_000).toFixed(2))} s`;
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3_600)}h ${Math.floor((seconds % 3_600) / 60)}m ${seconds % 60}s`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? "Unavailable" : `${Number(rate.toFixed(1))}%`;
}

export function formatRecordedAt(value: string | null): string {
  if (value === null || !Number.isFinite(Date.parse(value))) return "Unavailable";
  return new Date(value).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

const verdictOrder: Record<RecordedVerdict, number> = {
  VERIFIED: 0,
  REVIEW_REQUIRED: 1,
  FAILED: 2,
};

// Work on a fresh array. The recorded cohort and its summary never change when
// a reader filters or sorts the table. Missing durations and dates sort last.
export function selectBenchmarkRows(
  rows: readonly BenchmarkRow[],
  {
    search,
    verdict,
    sort,
  }: { search: string; verdict: BenchmarkVerdictFilter; sort: BenchmarkSort },
): BenchmarkRow[] {
  const query = search.trim().toLocaleLowerCase("en");
  return rows
    .filter(
      (row) =>
        (!query ||
          `${row.scenario} ${row.repository ?? ""} ${row.missionId}`
            .toLocaleLowerCase("en")
            .includes(query)) &&
        (verdict === "all" ||
          (verdict === "none"
            ? row.verdict === null
            : row.verdict === verdict)),
    )
    .sort((left, right) => {
      const byScenario =
        left.scenario.localeCompare(right.scenario, "en") ||
        left.id.localeCompare(right.id, "en");
      if (sort === "scenario-desc") return -byScenario;
      if (sort === "recorded-asc" || sort === "recorded-desc") {
        const leftTime = left.recordedAt === null ? NaN : Date.parse(left.recordedAt);
        const rightTime = right.recordedAt === null ? NaN : Date.parse(right.recordedAt);
        if (!Number.isFinite(leftTime))
          return !Number.isFinite(rightTime) ? byScenario : 1;
        if (!Number.isFinite(rightTime)) return -1;
        return (
          (leftTime - rightTime) * (sort === "recorded-desc" ? -1 : 1) ||
          byScenario
        );
      }
      if (sort === "duration-asc" || sort === "duration-desc") {
        if (left.testDurationMs === null)
          return right.testDurationMs === null ? byScenario : 1;
        if (right.testDurationMs === null) return -1;
        return (
          (left.testDurationMs - right.testDurationMs) *
            (sort === "duration-desc" ? -1 : 1) || byScenario
        );
      }
      if (sort === "verdict-asc")
        return (
          (left.verdict === null ? 3 : verdictOrder[left.verdict]) -
            (right.verdict === null ? 3 : verdictOrder[right.verdict]) ||
          byScenario
        );
      return byScenario;
    });
}
