import { describe, expect, it } from "vitest";

import { buildPatchAgentContext } from "./patch-context.js";

describe("buildPatchAgentContext", () => {
  it("classifies recommended targets deterministically", () => {
    const result = buildPatchAgentContext({
      report: "Shared lifecycle cleanup is missing.",

      diagnosis: {
        rootCause: "DOM cleanup is not registered globally.",

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

        confidence: "HIGH",
      },
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
  });
});
