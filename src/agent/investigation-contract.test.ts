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

          confidence: "HIGH",
        },
      }),
    );

    expect(result.diagnosis.rootCause).toContain("cleanup");

    expect(result.diagnosis.recommendedPatchTargets).toEqual([
      "vitest.setup.ts",
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
    "confidence": "HIGH"
  }
}
\`\`\`
`);

    expect(result.diagnosis.confidence).toBe("HIGH");
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

            recommendedPatchTargets: ["/etc/passwd"],

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

            recommendedPatchTargets: ["../secret.txt"],

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

            evidence: [],

            relevantFiles: ["src/example.ts"],

            recommendedPatchTargets: ["src/example.ts"],

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
