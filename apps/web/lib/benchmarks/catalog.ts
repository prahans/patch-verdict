import type { BenchmarkScenario } from "./types";

// Pinned on 2026-10-20 after validating the saved version 2 proofs. The user
// selected the latest completed candidates for the three ambiguous repositories
// and explicitly selected debug-normalization-01. New runs never replace these.
// See docs/BENCHMARK_DASHBOARD.md for the selection record and backup procedure.

export const benchmarkCatalog: readonly BenchmarkScenario[] = [
  {
    id: "string-normalization",
    name: "Username String Normalization",
    repositoryUrl:
      "https://github.com/prahans/patchverdict-string-normalization",
    missionId: "debug-normalization-01",
  },
  {
    id: "divide-by-zero",
    name: "Division by zero",
    repositoryUrl: "https://github.com/prahans/patchverdict-divide-by-zero",
    missionId: "web-42a66b12-7219-4d6e-a799-c49f797aa13d",
  },
  {
    id: "array-boundary",
    name: "Array boundary",
    repositoryUrl: "https://github.com/prahans/patchverdict-array-boundary",
    missionId: "web-5e60fb32-602e-4bf3-9707-d58bbb6168bd",
  },
  {
    id: "boolean-condition",
    name: "Boolean condition",
    repositoryUrl: "https://github.com/prahans/patchverdict-boolean-condition",
    missionId: "web-b1439d1c-7727-4b7f-a8d2-367ceae8a8e4",
  },
  {
    id: "off-by-one",
    name: "Off-by-one range",
    repositoryUrl: "https://github.com/prahans/patchverdict-off-by-one",
    missionId: "web-4ac3cf2d-4bdd-4c96-b73b-dabca9c82109",
  },
  {
    id: "average-calculation",
    name: "Average calculation",
    repositoryUrl: "https://github.com/prahans/patchverdict-simple-bug",
    missionId: "web-69465de5-6600-42b8-96ec-8fb49fe24c72",
  },
  {
    id: "test-state-leak",
    name: "Test state leak",
    repositoryUrl: "https://github.com/prahans/patchverdict-test-state-leak",
    missionId: "web-d59e040c-e511-4d9e-bd6b-7cb6bfdd645d",
  },
];
