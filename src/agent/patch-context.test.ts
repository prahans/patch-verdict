import { describe, expect, it } from "vitest";

import { buildPatchAgentContext } from "./patch-context.js";

describe("buildPatchAgentContext", () => {
  it("classifies recommended targets deterministically", () => {
    const result = buildPatchAgentContext({
      report: "Shared lifecycle cleanup is missing.",

      diagnosis: {
        rootCause: "DOM cleanup is not registered globally.",

        rootCauseAnalysis: {
          failureMechanism:
            "Rendered DOM remains mounted because cleanup is absent from the shared test lifecycle.",

          primaryCause: {
            layer: "TEST_INFRASTRUCTURE",

            hypothesis:
              "The shared test lifecycle infrastructure does not register cleanup.",

            evidenceRefs: [
              {
                kind: "FILE",

                source: "vitest.setup.ts",
              },
            ],
          },

          alternatives: [],
        },

        scopeAnalysis: {
          scope: "SHARED",

          reason:
            "The missing cleanup behavior belongs to shared test lifecycle configuration.",

          evidenceRefs: [
            {
              kind: "FILE",

              source: "vitest.setup.ts",
            },
          ],
        },

        evidence: [
          {
            kind: "FILE",
            source: "vitest.setup.ts",

            observation: "No cleanup lifecycle is registered.",
          },
        ],

        relevantFiles: [
          "vitest.setup.ts",
          "src/components/DarkMode.test.tsx",
          "src/components/DarkMode.tsx",
        ],

        recommendedPatchTargets: [
          "vitest.setup.ts",
          "src/components/DarkMode.tsx",
          "src/components/DarkMode.test.tsx",
        ],
        patchTargetAnalysis: [
          {
            path: "vitest.setup.ts",

            decision: "RECOMMEND",

            reason: "This file directly addresses the diagnosed root cause.",

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

            objective:
              "Ensure shared cleanup runs between affected test cases.",

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
      },
    });

    expect(result.rootCauseAnalysis.primaryCause.layer).toBe(
      "TEST_INFRASTRUCTURE",
    );

    expect(result.scopeAnalysis).toEqual({
      scope: "SHARED",
      reason:
        "The missing cleanup behavior belongs to shared test lifecycle configuration.",
      evidenceRefs: [
        {
          kind: "FILE",
          source: "vitest.setup.ts",
        },
      ],
    });

    expect(result.recommendedPatchTargets).toEqual([
      {
        path: "vitest.setup.ts",

        verificationRole: "TEST_INFRASTRUCTURE",
      },

      {
        path: "src/components/DarkMode.tsx",

        verificationRole: "OTHER",
      },

      {
        path: "src/components/DarkMode.test.tsx",

        verificationRole: "TEST_FILE",
      },
    ]);

    expect(result.patchIntents).toEqual([
      {
        id: "intent-1",

        path: "vitest.setup.ts",

        objective:
          "Ensure shared cleanup runs between affected test cases.",

        repairKind: "ROOT_CAUSE_FIX",

        evidenceRefs: [
          {
            kind: "FILE",

            source: "vitest.setup.ts",
          },
        ],

        verificationRole: "TEST_INFRASTRUCTURE",
      },
    ]);
  });
});
