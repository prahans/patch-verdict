import { describe, expect, it } from "vitest";

import { parseInvestigationModelOutput } from "./investigation-contract.js";

describe("parseInvestigationModelOutput", () => {
  it("parses a valid structured investigation", () => {
    const result = parseInvestigationModelOutput(
      JSON.stringify({
        report: "The shared test cleanup lifecycle is missing.",

        diagnosis: {
          rootCause:
            "Rendered DOM survives between tests because shared cleanup is not configured.",

          evidence: [
            {
              kind: "FILE",
              source: "vitest.setup.ts",
              observation:
                "The setup file does not register Testing Library cleanup.",
            },

            {
              kind: "TEST",
              source: "DarkMode",
              observation:
                "The targeted suite reproduces duplicate DOM elements.",
            },
          ],

          relevantFiles: [
            "vitest.setup.ts",
            "src/components/DarkMode.test.tsx",
          ],

          recommendedPatchTargets: ["vitest.setup.ts"],

          patchTargetAnalysis: [
            {
              path: "vitest.setup.ts",
              decision: "RECOMMEND",
              reason:
                "The shared test setup is the smallest location that addresses the missing cleanup lifecycle.",
            },

            {
              path: "src/components/DarkMode.test.tsx",
              decision: "REJECT",
              reason:
                "Changing only the failing test would address the local symptom instead of the shared test lifecycle.",
            },
          ],

          confidence: "HIGH",
        },
      }),
    );

    expect(result.diagnosis.rootCause).toContain("cleanup");

    expect(result.diagnosis.recommendedPatchTargets).toEqual([
      "vitest.setup.ts",
    ]);

    expect(result.diagnosis.patchTargetAnalysis).toEqual([
      {
        path: "vitest.setup.ts",
        decision: "RECOMMEND",
        reason:
          "The shared test setup is the smallest location that addresses the missing cleanup lifecycle.",
      },

      {
        path: "src/components/DarkMode.test.tsx",
        decision: "REJECT",
        reason:
          "Changing only the failing test would address the local symptom instead of the shared test lifecycle.",
      },
    ]);

    expect(result.diagnosis.confidence).toBe("HIGH");
  });

  it("accepts fenced JSON", () => {
    const result = parseInvestigationModelOutput(`
\`\`\`json
{
  "report": "Root cause identified.",
  "diagnosis": {
    "rootCause": "Incorrect state transition.",
    "evidence": [
      {
        "kind": "FILE",
        "source": "src/state.ts",
        "observation": "The transition writes the wrong value."
      }
    ],
    "relevantFiles": [
      "src/state.ts"
    ],
    "recommendedPatchTargets": [
      "src/state.ts"
    ],
    "patchTargetAnalysis": [
      {
        "path": "src/state.ts",
        "decision": "RECOMMEND",
        "reason": "This file contains the incorrect state transition and directly addresses the diagnosed root cause."
      }
    ],
    "confidence": "HIGH"
  }
}
\`\`\`
`);

    expect(result.diagnosis.confidence).toBe("HIGH");

    expect(result.diagnosis.patchTargetAnalysis).toEqual([
      {
        path: "src/state.ts",
        decision: "RECOMMEND",
        reason:
          "This file contains the incorrect state transition and directly addresses the diagnosed root cause.",
      },
    ]);
  });

  it("rejects absolute patch targets", () => {
    expect(() =>
      parseInvestigationModelOutput(
        JSON.stringify({
          report: "Invalid target.",

          diagnosis: {
            rootCause: "Example root cause.",

            evidence: [
              {
                kind: "FILE",
                source: "src/example.ts",
                observation: "Observed defect.",
              },
            ],

            relevantFiles: ["src/example.ts"],

            /*
             * Intentionally invalid.
             */
            recommendedPatchTargets: ["/etc/passwd"],

            patchTargetAnalysis: [
              {
                path: "src/example.ts",

                decision: "REJECT",

                reason:
                  "This valid analysis entry keeps the test focused on the invalid recommended target path.",
              },
            ],

            confidence: "MEDIUM",
          },
        }),
      ),
    ).toThrow(/repository-relative path/i);
  });

  it("rejects path traversal targets", () => {
    expect(() =>
      parseInvestigationModelOutput(
        JSON.stringify({
          report: "Invalid target.",

          diagnosis: {
            rootCause: "Example root cause.",

            evidence: [
              {
                kind: "FILE",
                source: "src/example.ts",
                observation: "Observed defect.",
              },
            ],

            relevantFiles: ["src/example.ts"],

            /*
             * Intentionally invalid.
             */
            recommendedPatchTargets: ["../secret.txt"],

            patchTargetAnalysis: [
              {
                path: "src/example.ts",

                decision: "REJECT",

                reason:
                  "This valid analysis entry keeps the test focused on repository path traversal rejection.",
              },
            ],

            confidence: "LOW",
          },
        }),
      ),
    ).toThrow(/repository-relative path/i);
  });

  it("rejects missing evidence", () => {
    expect(() =>
      parseInvestigationModelOutput(
        JSON.stringify({
          report: "Unsupported diagnosis.",

          diagnosis: {
            rootCause: "Something is wrong.",

            /*
             * Intentionally empty.
             */
            evidence: [],

            relevantFiles: ["src/example.ts"],

            recommendedPatchTargets: ["src/example.ts"],

            patchTargetAnalysis: [
              {
                path: "src/example.ts",

                decision: "RECOMMEND",

                reason:
                  "This target is structurally valid so this test isolates the missing-evidence rule.",
              },
            ],

            confidence: "LOW",
          },
        }),
      ),
    ).toThrow(/structured diagnosis/i);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseInvestigationModelOutput("{ not valid json }")).toThrow(
      /invalid JSON/i,
    );
  });
});
