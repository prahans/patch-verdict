import type { BenchmarkScenario } from "./types";

// Register the exact saved run for each controlled scenario here. Intentionally
// empty: the six intended benchmark runs cannot be identified confidently from
// the local history. See docs/BENCHMARK_DASHBOARD.md before adding entries.

export const benchmarkCatalog: readonly BenchmarkScenario[] = [
  {
    id: "string-normalization",
    name: "Username String Normalization",
    repositoryUrl:
      "https://github.com/prahans/patchverdict-string-normalization",
    missionId: "debug-normalization-01",
  },
];
