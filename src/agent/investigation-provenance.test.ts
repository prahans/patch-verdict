import { describe, expect, it } from "vitest";

import { assertInvestigationProvenance } from "./investigation-provenance.js";

const diagnosis = {
  rootCause: "Shared cleanup is missing.",

  evidence: [
    {
      kind: "FILE" as const,
      source: "vitest.setup.ts",
      observation: "Cleanup is not registered.",
    },
  ],

  relevantFiles: ["vitest.setup.ts"],

  recommendedPatchTargets: ["vitest.setup.ts"],

  confidence: "HIGH" as const,
};

describe("assertInvestigationProvenance", () => {
  it("accepts a fully grounded diagnosis", () => {
    expect(() =>
      assertInvestigationProvenance(diagnosis, {
        inspectedFiles: ["vitest.setup.ts"],

        executedTests: [],
        searchQueries: [],
      }),
    ).not.toThrow();
  });

  it("rejects a diagnosis with no inspected files", () => {
    expect(() =>
      assertInvestigationProvenance(diagnosis, {
        inspectedFiles: [],
        executedTests: [],
        searchQueries: [],
      }),
    ).toThrow(/No repository file was successfully inspected/i);
  });

  it("rejects an uninspected recommended target", () => {
    expect(() =>
      assertInvestigationProvenance(
        {
          ...diagnosis,

          relevantFiles: ["src/fake.ts"],

          recommendedPatchTargets: ["src/fake.ts"],
        },
        {
          inspectedFiles: ["vitest.setup.ts"],

          executedTests: [],
          searchQueries: [],
        },
      ),
    ).toThrow(/not inspected/i);
  });

  it("requires patch targets to also be relevant files", () => {
    expect(() =>
      assertInvestigationProvenance(
        {
          ...diagnosis,

          relevantFiles: ["src/example.ts"],
        },
        {
          inspectedFiles: ["vitest.setup.ts", "src/example.ts"],

          executedTests: [],
          searchQueries: [],
        },
      ),
    ).toThrow(/not present in relevantFiles/i);
  });

  it("rejects TEST evidence that was never executed", () => {
    expect(() =>
      assertInvestigationProvenance(
        {
          ...diagnosis,

          evidence: [
            {
              kind: "TEST" as const,

              source: "DarkMode",

              observation: "The suite failed.",
            },
          ],
        },
        {
          inspectedFiles: ["vitest.setup.ts"],

          executedTests: [],
          searchQueries: [],
        },
      ),
    ).toThrow(/was not executed/i);
  });

  it("accepts TEST evidence when that selector was executed", () => {
    expect(() =>
      assertInvestigationProvenance(
        {
          ...diagnosis,

          evidence: [
            ...diagnosis.evidence,

            {
              kind: "TEST" as const,

              source: "DarkMode",

              observation:
                "The targeted suite reproduced the observed failure.",
            },
          ],
        },

        {
          inspectedFiles: ["vitest.setup.ts"],

          executedTests: ["DarkMode"],

          searchQueries: [],
        },
      ),
    ).not.toThrow();
  });
});

it("rejects relevant files without FILE evidence", () => {
  expect(() =>
    assertInvestigationProvenance(
      {
        rootCause: "Shared cleanup is missing.",

        evidence: [
          {
            kind: "FILE",
            source: "src/components/DarkMode.test.tsx",
            observation: "The test renders DOM.",
          },
        ],

        relevantFiles: ["src/components/DarkMode.test.tsx", "vitest.setup.ts"],

        recommendedPatchTargets: ["src/components/DarkMode.test.tsx"],

        confidence: "HIGH",
      },

      {
        inspectedFiles: ["src/components/DarkMode.test.tsx", "vitest.setup.ts"],

        executedTests: [],
        searchQueries: [],
      },
    ),
  ).toThrow(/has no FILE evidence observation/i);
});
