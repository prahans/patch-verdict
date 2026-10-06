import { describe, expect, it } from "vitest";

import type { InvestigationDiagnosis } from "./investigation-contract.js";
import { assertNoSemanticDriftDuringContractRepair } from "./investigation-repair-guard.js";

const diagnosis = {
  rootCause: "Shared cleanup behavior is missing.",

  rootCauseAnalysis: {
    failureMechanism:
      "Rendered DOM survives between tests and contaminates later assertions.",

    primaryCause: {
      layer: "DEPENDENCY_RUNTIME",
      hypothesis:
        "The test runtime lifecycle does not preserve automatic cleanup registration for later suites.",
      evidenceRefs: [
        {
          kind: "TEST",
          source: "npm test",
        },
      ],
    },

    alternatives: [
      {
        layer: "TEST_INFRASTRUCTURE",
        hypothesis:
          "The repository test setup itself may own the missing cleanup behavior.",
        status: "UNRESOLVED",
        reason:
          "The current evidence does not yet distinguish setup ownership from runtime behavior.",
        evidenceRefs: [
          {
            kind: "FILE",
            source: "vitest.setup.ts",
          },
        ],
      },
    ],
  },

  scopeAnalysis: {
    scope: "SHARED",
    reason: "The observed failure crosses test lifecycle boundaries.",
    evidenceRefs: [
      {
        kind: "TEST",
        source: "npm test",
      },
      {
        kind: "FILE",
        source: "vitest.setup.ts",
      },
    ],
  },

  evidence: [
    {
      kind: "TEST",
      source: "npm test",
      observation: "The baseline shows stale rendered DOM.",
    },
    {
      kind: "FILE",
      source: "vitest.setup.ts",
      observation: "The shared setup file was inspected.",
    },
  ],

  relevantFiles: ["vitest.setup.ts"],

  recommendedPatchTargets: ["vitest.setup.ts"],

  patchTargetAnalysis: [
    {
      path: "vitest.setup.ts",
      decision: "RECOMMEND",
      reason: "The setup file is a bounded workaround location.",
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
      objective: "Restore cleanup behavior between test cases.",
      repairKind: "WORKAROUND",
      evidenceRefs: [
        {
          kind: "FILE",
          source: "vitest.setup.ts",
        },
      ],
    },
  ],

  confidence: "MEDIUM",
} satisfies InvestigationDiagnosis;

describe("contract-repair semantic guard", () => {
  it("allows citation and explanatory-text repair without semantic drift", () => {
    expect(() =>
      assertNoSemanticDriftDuringContractRepair(diagnosis, {
        ...diagnosis,
        rootCauseAnalysis: {
          ...diagnosis.rootCauseAnalysis,
          primaryCause: {
            ...diagnosis.rootCauseAnalysis.primaryCause,
            evidenceRefs: [
              {
                kind: "TEST",
                source: "npm test",
              },
              {
                kind: "FILE",
                source: "vitest.setup.ts",
              },
            ],
          },
          alternatives: diagnosis.rootCauseAnalysis.alternatives.map(
            (alternative) => ({
              ...alternative,
              reason:
                "Updated explanation using only evidence that was already observed.",
            }),
          ),
        },
        scopeAnalysis: {
          ...diagnosis.scopeAnalysis,
          reason:
            "Updated scope explanation using the same semantic classification.",
        },
      }),
    ).not.toThrow();
  });

  it("rejects changing the patch target during no-tool repair", () => {
    expect(() =>
      assertNoSemanticDriftDuringContractRepair(diagnosis, {
        ...diagnosis,
        recommendedPatchTargets: ["src/components/DarkMode.test.tsx"],
        patchTargetAnalysis: [
          {
            ...diagnosis.patchTargetAnalysis[0]!,
            path: "src/components/DarkMode.test.tsx",
          },
        ],
        patchIntents: [
          {
            ...diagnosis.patchIntents[0]!,
            path: "src/components/DarkMode.test.tsx",
          },
        ],
      }),
    ).toThrow(/attempted to change investigation semantics/i);
  });

  it("rejects changing cause layer or repair kind during no-tool repair", () => {
    expect(() =>
      assertNoSemanticDriftDuringContractRepair(diagnosis, {
        ...diagnosis,
        rootCauseAnalysis: {
          ...diagnosis.rootCauseAnalysis,
          primaryCause: {
            ...diagnosis.rootCauseAnalysis.primaryCause,
            layer: "TEST_INFRASTRUCTURE",
          },
        },
        patchIntents: [
          {
            ...diagnosis.patchIntents[0]!,
            repairKind: "ROOT_CAUSE_FIX",
          },
        ],
      }),
    ).toThrow(/attempted to change investigation semantics/i);
  });
});
