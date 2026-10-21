import type { BenchmarkScenario } from "./types";

// Fixed selections retained from the reviewed dashboard implementation.
// Who selected these historical runs and why remains unconfirmed; see the
// provenance review note in docs/BENCHMARK_DASHBOARD.md. New runs never replace
// these selections. The document also describes the private backup procedure.

export const benchmarkCatalog: readonly BenchmarkScenario[] = [
  {
    id: "string-normalization",
    name: "Username Normalization",
    repositoryUrl:
      "https://github.com/prahans/patchverdict-string-normalization",
    missionId: "debug-normalization-01",
  },
  {
    id: "divide-by-zero",
    name: "Division by Zero",
    repositoryUrl: "https://github.com/prahans/patchverdict-divide-by-zero",
    missionId: "web-42a66b12-7219-4d6e-a799-c49f797aa13d",
  },
  {
    id: "array-boundary",
    name: "Array Boundary",
    repositoryUrl: "https://github.com/prahans/patchverdict-array-boundary",
    missionId: "web-5e60fb32-602e-4bf3-9707-d58bbb6168bd",
  },
  {
    id: "boolean-condition",
    name: "Boolean Condition",
    repositoryUrl: "https://github.com/prahans/patchverdict-boolean-condition",
    missionId: "web-b1439d1c-7727-4b7f-a8d2-367ceae8a8e4",
  },
  {
    id: "off-by-one",
    name: "Off-by-One Range",
    repositoryUrl: "https://github.com/prahans/patchverdict-off-by-one",
    missionId: "web-4ac3cf2d-4bdd-4c96-b73b-dabca9c82109",
  },
  {
    id: "average-calculation",
    name: "Average Calculation",
    repositoryUrl: "https://github.com/prahans/patchverdict-simple-bug",
    missionId: "web-69465de5-6600-42b8-96ec-8fb49fe24c72",
  },
  {
    id: "test-state-leak",
    name: "Test State Leak",
    repositoryUrl: "https://github.com/prahans/patchverdict-test-state-leak",
    missionId: "web-d59e040c-e511-4d9e-bd6b-7cb6bfdd645d",
  },
];
