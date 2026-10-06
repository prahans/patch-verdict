import { describe, expect, it } from "vitest";

import type { InvestigationDiagnosis } from "./investigation-contract.js";

import {
  assertCausalContextCoverage,
  findCausalContextCandidates,
  findUninspectedCausalContext,
} from "./investigation-causal-context.js";

const diagnosis = {
  rootCause: "Shared cleanup behavior is missing.",

  rootCauseAnalysis: {
    failureMechanism:
      "Rendered DOM survives between test cases and contaminates later assertions.",

    primaryCause: {
      layer: "TEST_INFRASTRUCTURE",
      hypothesis:
        "The shared test lifecycle infrastructure does not provide the required cleanup behavior.",
      evidenceRefs: [
        {
          kind: "FILE",
          source: "vitest.setup.ts",
        },
        {
          kind: "FILE",
          source: "vite.config.ts",
        },
        {
          kind: "FILE",
          source: "package.json",
        },
      ],
    },

    alternatives: [],
  },

  scopeAnalysis: {
    scope: "SHARED",
    reason: "The failure involves shared test lifecycle behavior.",
    evidenceRefs: [
      {
        kind: "FILE",
        source: "vitest.setup.ts",
      },
      {
        kind: "TEST",
        source: "npm test",
      },
    ],
  },

  evidence: [
    {
      kind: "FILE",
      source: "vitest.setup.ts",
      observation: "The setup file does not register explicit cleanup.",
    },
    {
      kind: "FILE",
      source: "vite.config.ts",
      observation: "The test runner configuration was inspected.",
    },
    {
      kind: "FILE",
      source: "package.json",
      observation: "The package manifest identifies the test runtime dependencies.",
    },
    {
      kind: "TEST",
      source: "npm test",
      observation: "The baseline shows stale DOM between tests.",
    },
  ],

  relevantFiles: ["vitest.setup.ts"],

  recommendedPatchTargets: ["vitest.setup.ts"],

  patchTargetAnalysis: [
    {
      path: "vitest.setup.ts",
      decision: "RECOMMEND",
      reason: "The shared setup is a bounded repair location.",
      evidenceRefs: [
        {
          kind: "FILE",
          source: "vitest.setup.ts",
        },
      ],
    },
  ],

  patchIntents: [
    {
      id: "intent-1",
      path: "vitest.setup.ts",
      objective: "Restore cleanup behavior between affected tests.",
      repairKind: "ROOT_CAUSE_FIX",
      evidenceRefs: [
        {
          kind: "FILE",
          source: "vitest.setup.ts",
        },
      ],
    },
  ],

  confidence: "HIGH",
} satisfies InvestigationDiagnosis;

const discoveredFiles = [
  "package.json",
  "vite.config.ts",
  "vitest.setup.ts",
  "src/components/DarkMode.test.tsx",
];

describe("causal environment context", () => {
  it("discovers manifest and runner configuration candidates", () => {
    expect(findCausalContextCandidates(discoveredFiles)).toEqual({
      packageManifests: ["package.json"],
      runnerConfigs: ["vite.config.ts"],
    });
  });

  it("reports uninspected causal context", () => {
    expect(
      findUninspectedCausalContext(discoveredFiles, ["vitest.setup.ts"]),
    ).toEqual(["package.json", "vite.config.ts"]);
  });

  it("rejects high-confidence test-infrastructure cause without environment inspection", () => {
    expect(() =>
      assertCausalContextCoverage(diagnosis, {
        discoveredFiles,
        inspectedFiles: ["vitest.setup.ts"],
      }),
    ).toThrow(/cannot be finalized before inspecting/i);
  });

  it("accepts strong causal classification when discovered environment context was inspected and used", () => {
    expect(() =>
      assertCausalContextCoverage(diagnosis, {
        discoveredFiles,
        inspectedFiles: [
          "vitest.setup.ts",
          "vite.config.ts",
          "package.json",
        ],
      }),
    ).not.toThrow();
  });

  it("rejects inspected environment context that causal reasoning silently ignores", () => {
    expect(() =>
      assertCausalContextCoverage(
        {
          ...diagnosis,
          rootCauseAnalysis: {
            ...diagnosis.rootCauseAnalysis,
            primaryCause: {
              ...diagnosis.rootCauseAnalysis.primaryCause,
              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "vitest.setup.ts",
                },
              ],
            },
          },
        },
        {
          discoveredFiles,
          inspectedFiles: [
            "vitest.setup.ts",
            "vite.config.ts",
            "package.json",
          ],
        },
      ),
    ).toThrow(/did not account for it/i);
  });

  it("allows a medium-confidence workaround without forcing uninspected environment context", () => {
    expect(() =>
      assertCausalContextCoverage(
        {
          ...diagnosis,
          confidence: "MEDIUM",
          patchIntents: [
            {
              ...diagnosis.patchIntents[0]!,
              repairKind: "WORKAROUND",
            },
          ],
        },
        {
          discoveredFiles,
          inspectedFiles: ["vitest.setup.ts"],
        },
      ),
    ).not.toThrow();
  });
});
