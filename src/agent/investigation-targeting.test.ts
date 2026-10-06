import { describe, expect, it } from "vitest";

import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { assertPatchTargetAnalysis } from "./investigation-targeting.js";

const diagnosis = {
  rootCause: "Shared test cleanup is missing.",

  evidence: [
    {
      kind: "FILE" as const,
      source: "vitest.setup.ts",
      observation: "The shared setup does not register cleanup.",
    },

    {
      kind: "FILE" as const,
      source: "src/components/DarkMode.test.tsx",
      observation: "The test renders DOM and exposes accumulated state.",
    },
  ],

  relevantFiles: ["vitest.setup.ts", "src/components/DarkMode.test.tsx"],

  recommendedPatchTargets: ["vitest.setup.ts"],

  patchTargetAnalysis: [
    {
      path: "vitest.setup.ts",

      decision: "RECOMMEND" as const,

      reason:
        "This shared lifecycle setup can establish cleanup for every affected test.",
    },

    {
      path: "src/components/DarkMode.test.tsx",

      decision: "REJECT" as const,

      reason:
        "Changing only this test would fix the local symptom rather than the shared lifecycle.",
    },
  ],

  patchIntents: [
    {
      id: "intent-1",

      path: "vitest.setup.ts",

      objective:
        "Ensure the shared test lifecycle cleans rendered DOM between tests.",

      evidenceRefs: [
        {
          kind: "FILE" as const,

          source: "vitest.setup.ts",
        },
      ],
    },
  ],

  confidence: "HIGH" as const,
} satisfies InvestigationDiagnosis;

const targetingContext = {
  inspectedFiles: ["vitest.setup.ts", "src/components/DarkMode.test.tsx"],
};

describe("assertPatchTargetAnalysis", () => {
  it("accepts an explicit shared-root comparison", () => {
    expect(() =>
      assertPatchTargetAnalysis(diagnosis, targetingContext),
    ).not.toThrow();
  });

  it("rejects a recommended target with no analysis", () => {
    expect(() =>
      assertPatchTargetAnalysis(
        {
          ...diagnosis,

          patchTargetAnalysis: [
            {
              path: "src/components/DarkMode.test.tsx",

              decision: "REJECT",

              reason:
                "This is only the visible failure location and not the shared root cause.",
            },
          ],
        },
        targetingContext,
      ),
    ).toThrow(/has no patch-target analysis/i);
  });

  it("rejects hidden recommendations", () => {
    expect(() =>
      assertPatchTargetAnalysis(
        {
          ...diagnosis,

          patchTargetAnalysis: [
            ...diagnosis.patchTargetAnalysis,

            {
              path: "src/components/DarkMode.tsx",

              decision: "RECOMMEND",

              reason:
                "Example unsupported extra recommendation for validation.",
            },
          ],

          relevantFiles: [
            ...diagnosis.relevantFiles,
            "src/components/DarkMode.tsx",
          ],
        },
        targetingContext,
      ),
    ).toThrow(/not present in recommendedPatchTargets/i);
  });

  it("rejects analysis for a non-relevant file", () => {
    expect(() =>
      assertPatchTargetAnalysis(
        {
          ...diagnosis,

          patchTargetAnalysis: [
            ...diagnosis.patchTargetAnalysis,

            {
              path: "src/unrelated.ts",

              decision: "REJECT",

              reason:
                "This file is intentionally unrelated for the validation test.",
            },
          ],
        },
        targetingContext,
      ),
    ).toThrow(/not present in relevantFiles/i);
  });

  it("requires test infrastructure comparison before recommending a direct test", () => {
    expect(() =>
      assertPatchTargetAnalysis(
        {
          ...diagnosis,

          recommendedPatchTargets: ["src/components/DarkMode.test.tsx"],

          patchTargetAnalysis: [
            {
              path: "src/components/DarkMode.test.tsx",

              decision: "RECOMMEND",

              reason: "The test file is proposed as the patch location.",
            },
          ],
        },
        targetingContext,
      ),
    ).toThrow(/missing analysis for: vitest\.setup\.ts/i);
  });

  it("allows a direct test recommendation when inspected infrastructure is explicitly rejected", () => {
    expect(() =>
      assertPatchTargetAnalysis(
        {
          rootCause: "The defect is isolated to this test's custom lifecycle.",

          evidence: [
            {
              kind: "FILE",
              source: "src/components/DarkMode.test.tsx",
              observation:
                "This test owns a custom lifecycle requiring local teardown.",
            },

            {
              kind: "FILE",
              source: "vitest.setup.ts",
              observation:
                "The shared setup is already configured correctly and is not the source of this local lifecycle defect.",
            },
          ],

          relevantFiles: [
            "src/components/DarkMode.test.tsx",
            "vitest.setup.ts",
          ],

          recommendedPatchTargets: ["src/components/DarkMode.test.tsx"],

          patchTargetAnalysis: [
            {
              path: "src/components/DarkMode.test.tsx",

              decision: "RECOMMEND",

              reason: "The lifecycle defect is isolated to this direct test.",
            },

            {
              path: "vitest.setup.ts",

              decision: "REJECT",

              reason:
                "The shared setup is already correct and should not be modified for this isolated lifecycle defect.",
            },
          ],

          patchIntents: [
            {
              id: "intent-1",

              path: "src/components/DarkMode.test.tsx",

              objective:
                "Add local teardown for this test-specific lifecycle.",

              evidenceRefs: [
                {
                  kind: "FILE",

                  source: "src/components/DarkMode.test.tsx",
                },
              ],
            },
          ],

          confidence: "HIGH",
        },

        {
          inspectedFiles: [
            "src/components/DarkMode.test.tsx",
            "vitest.setup.ts",
          ],
        },
      ),
    ).not.toThrow();
  });
});
