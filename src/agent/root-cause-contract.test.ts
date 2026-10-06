import { describe, expect, it } from "vitest";

import {
  assertRepairKindCompatibleWithCause,
  assertRootCauseAnalysisGrounding,
  type RootCauseAnalysis,
} from "./root-cause-contract.js";

const evidence = [
  {
    kind: "FILE" as const,
    source: "vite.config.ts",
  },
  {
    kind: "FILE" as const,
    source: "vitest.setup.ts",
  },
  {
    kind: "TEST" as const,
    source: "npm test",
  },
];

const analysis = {
  failureMechanism:
    "Automatic cleanup is not active for later suites, so rendered DOM survives between tests.",

  primaryCause: {
    layer: "DEPENDENCY_RUNTIME",
    hypothesis:
      "The configured Vitest execution mode interacts with cached Testing Library module state so automatic cleanup hooks are not active for later suites.",
    evidenceRefs: [
      {
        kind: "FILE",
        source: "vite.config.ts",
      },
      {
        kind: "TEST",
        source: "npm test",
      },
    ],
  },

  alternatives: [
    {
      layer: "TEST_FILE",
      hypothesis:
        "The failing DarkMode test alone owns the missing cleanup lifecycle.",
      status: "REJECTED",
      reason:
        "The observed behavior is explained by a lifecycle interaction outside the individual test file.",
      evidenceRefs: [
        {
          kind: "TEST",
          source: "npm test",
        },
      ],
    },
  ],
} satisfies RootCauseAnalysis;

describe("Root Cause Contract v3", () => {
  it("accepts an evidence-grounded dependency-runtime cause", () => {
    expect(() =>
      assertRootCauseAnalysisGrounding(analysis, evidence, "HIGH"),
    ).not.toThrow();
  });

  it("rejects primary cause evidence that was not observed", () => {
    expect(() =>
      assertRootCauseAnalysisGrounding(
        {
          ...analysis,
          primaryCause: {
            ...analysis.primaryCause,
            evidenceRefs: [
              {
                kind: "FILE",
                source: "src/made-up.ts",
              },
            ],
          },
        },
        evidence,
        "MEDIUM",
      ),
    ).toThrow(/does not exist in investigation evidence/i);
  });

  it("requires runtime evidence for a DEPENDENCY_RUNTIME cause", () => {
    expect(() =>
      assertRootCauseAnalysisGrounding(
        {
          ...analysis,
          primaryCause: {
            ...analysis.primaryCause,
            evidenceRefs: [
              {
                kind: "FILE",
                source: "vite.config.ts",
              },
            ],
          },
        },
        evidence,
        "MEDIUM",
      ),
    ).toThrow(/must cite TEST evidence/i);
  });

  it("rejects HIGH confidence when the cause layer is UNKNOWN", () => {
    expect(() =>
      assertRootCauseAnalysisGrounding(
        {
          ...analysis,
          primaryCause: {
            layer: "UNKNOWN",
            hypothesis:
              "The evidence identifies the failure mechanism but not the layer that owns the underlying cause.",
            evidenceRefs: [
              {
                kind: "TEST",
                source: "npm test",
              },
            ],
          },
        },
        evidence,
        "HIGH",
      ),
    ).toThrow(/UNKNOWN cannot be paired with HIGH/i);
  });

  it("rejects an alternative that duplicates the primary hypothesis", () => {
    expect(() =>
      assertRootCauseAnalysisGrounding(
        {
          ...analysis,
          alternatives: [
            {
              layer: analysis.primaryCause.layer,
              hypothesis: analysis.primaryCause.hypothesis,
              status: "UNRESOLVED",
              reason:
                "This duplicate is intentionally invalid for contract testing.",
              evidenceRefs: analysis.primaryCause.evidenceRefs,
            },
          ],
        },
        evidence,
        "MEDIUM",
      ),
    ).toThrow(/duplicates the primary cause/i);
  });


  it("requires runtime evidence for DEPENDENCY_RUNTIME alternatives", () => {
    expect(() =>
      assertRootCauseAnalysisGrounding(
        {
          ...analysis,
          alternatives: [
            {
              layer: "DEPENDENCY_RUNTIME",
              hypothesis:
                "A competing runtime caching behavior may own the cleanup failure.",
              status: "UNRESOLVED",
              reason:
                "This fixture intentionally omits runtime TEST evidence.",
              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "vite.config.ts",
                },
              ],
            },
          ],
        },
        evidence,
        "MEDIUM",
      ),
    ).toThrow(/Alternative DEPENDENCY_RUNTIME cause.*must cite TEST evidence/i);
  });

  it("rejects HIGH confidence while a competing cause remains unresolved", () => {
    expect(() =>
      assertRootCauseAnalysisGrounding(
        {
          ...analysis,
          alternatives: [
            {
              layer: "CONFIGURATION",
              hypothesis:
                "A repository configuration option may be responsible for the missing cleanup lifecycle.",
              status: "UNRESOLVED",
              reason:
                "The current evidence has not distinguished this configuration hypothesis from the primary runtime hypothesis.",
              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "vite.config.ts",
                },
              ],
            },
          ],
        },
        evidence,
        "HIGH",
      ),
    ).toThrow(/competing cause remains UNRESOLVED/i);
  });

  it("does not allow ROOT_CAUSE_FIX when the cause is unknown", () => {
    expect(() =>
      assertRepairKindCompatibleWithCause({
        repairKind: "ROOT_CAUSE_FIX",
        causeLayer: "UNKNOWN",
        targetRole: "OTHER",
      }),
    ).toThrow(/cause layer is UNKNOWN/i);
  });

  it("classifies test-infrastructure repair of a dependency-runtime cause as non-root-cause", () => {
    expect(() =>
      assertRepairKindCompatibleWithCause({
        repairKind: "ROOT_CAUSE_FIX",
        causeLayer: "DEPENDENCY_RUNTIME",
        targetRole: "TEST_INFRASTRUCTURE",
      }),
    ).toThrow(/WORKAROUND or MITIGATION/i);
  });

  it("rejects a root-cause fix whose target role does not own the identified cause", () => {
    expect(() =>
      assertRepairKindCompatibleWithCause({
        repairKind: "ROOT_CAUSE_FIX",
        causeLayer: "TEST_INFRASTRUCTURE",
        targetRole: "TEST_FILE",
      }),
    ).toThrow(/expected target role TEST_INFRASTRUCTURE/i);
  });

  it("allows a root-cause fix when the target role owns the identified cause", () => {
    expect(() =>
      assertRepairKindCompatibleWithCause({
        repairKind: "ROOT_CAUSE_FIX",
        causeLayer: "TEST_SUPPORT",
        targetRole: "TEST_SUPPORT",
      }),
    ).not.toThrow();
  });

  it("allows a WORKAROUND against test infrastructure for a dependency-runtime cause", () => {
    expect(() =>
      assertRepairKindCompatibleWithCause({
        repairKind: "WORKAROUND",
        causeLayer: "DEPENDENCY_RUNTIME",
        targetRole: "TEST_INFRASTRUCTURE",
      }),
    ).not.toThrow();
  });
});
