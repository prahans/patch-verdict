import { describe, expect, it } from "vitest";

import type { InvestigationDiagnosis } from "./investigation-contract.js";
import { assertInvestigationProvenance } from "./investigation-provenance.js";

const diagnosis = {
  rootCause: "Shared cleanup is missing.",

  evidence: [
    {
      kind: "FILE",
      source: "vitest.setup.ts",
      observation: "Cleanup is not registered.",
    },
  ],

  relevantFiles: ["vitest.setup.ts"],

  recommendedPatchTargets: ["vitest.setup.ts"],

  patchTargetAnalysis: [
    {
      path: "vitest.setup.ts",
      decision: "RECOMMEND",
      reason:
        "The shared test setup is the smallest location that addresses the missing cleanup lifecycle.",
    },
  ],

  patchIntents: [
    {
      id: "intent-1",
      path: "vitest.setup.ts",
      objective: "Ensure rendered DOM is cleaned between tests.",
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
    const uninspectedDiagnosis = {
      ...diagnosis,

      evidence: [
        ...diagnosis.evidence,
        {
          kind: "FILE" as const,
          source: "src/fake.ts",
          observation: "This file is claimed as a possible patch location.",
        },
      ],

      relevantFiles: ["vitest.setup.ts", "src/fake.ts"],

      recommendedPatchTargets: ["src/fake.ts"],

      patchTargetAnalysis: [
        {
          path: "src/fake.ts",
          decision: "RECOMMEND" as const,
          reason:
            "This file is intentionally used as an uninspected target for the test.",
        },
      ],
    };

    expect(() =>
      assertInvestigationProvenance(uninspectedDiagnosis, {
        inspectedFiles: ["vitest.setup.ts"],

        executedTests: [],
        searchQueries: [],
      }),
    ).toThrow(/not inspected/i);
  });

  it("requires patch targets to also be relevant files", () => {
    const inconsistentDiagnosis = {
      ...diagnosis,

      evidence: [
        {
          kind: "FILE" as const,
          source: "src/example.ts",
          observation: "The example file was inspected and is relevant.",
        },
      ],

      relevantFiles: ["src/example.ts"],

      /*
       * vitest.setup.ts is intentionally
       * NOT present in relevantFiles.
       */
      recommendedPatchTargets: ["vitest.setup.ts"],

      patchTargetAnalysis: [
        {
          path: "vitest.setup.ts",
          decision: "RECOMMEND" as const,
          reason:
            "This intentionally inconsistent target verifies the relevant-file rule.",
        },
      ],
    };

    expect(() =>
      assertInvestigationProvenance(inconsistentDiagnosis, {
        inspectedFiles: ["src/example.ts", "vitest.setup.ts"],

        executedTests: [],
        searchQueries: [],
      }),
    ).toThrow(/not present in relevantFiles/i);
  });

  it("rejects TEST evidence that was never executed", () => {
    const testEvidenceDiagnosis = {
      ...diagnosis,

      evidence: [
        ...diagnosis.evidence,

        {
          kind: "TEST" as const,
          source: "DarkMode",
          observation: "The targeted suite reproduced the observed failure.",
        },
      ],
    };

    expect(() =>
      assertInvestigationProvenance(testEvidenceDiagnosis, {
        inspectedFiles: ["vitest.setup.ts"],

        executedTests: [],
        searchQueries: [],
      }),
    ).toThrow(/was not executed/i);
  });

  it("accepts TEST evidence when that selector was executed", () => {
    const testEvidenceDiagnosis = {
      ...diagnosis,

      evidence: [
        ...diagnosis.evidence,

        {
          kind: "TEST" as const,
          source: "DarkMode",
          observation: "The targeted suite reproduced the observed failure.",
        },
      ],
    };

    expect(() =>
      assertInvestigationProvenance(testEvidenceDiagnosis, {
        inspectedFiles: ["vitest.setup.ts"],

        executedTests: ["DarkMode"],

        searchQueries: [],
      }),
    ).not.toThrow();
  });

  it("rejects relevant files without FILE evidence", () => {
    const missingFileEvidenceDiagnosis = {
      rootCause: "Shared cleanup is missing.",

      evidence: [
        {
          kind: "FILE" as const,
          source: "src/components/DarkMode.test.tsx",
          observation: "The test renders DOM.",
        },
      ],

      relevantFiles: ["src/components/DarkMode.test.tsx", "vitest.setup.ts"],

      recommendedPatchTargets: ["src/components/DarkMode.test.tsx"],

      patchTargetAnalysis: [
        {
          path: "src/components/DarkMode.test.tsx",

          decision: "RECOMMEND" as const,

          reason:
            "This test intentionally verifies that every relevant file requires FILE evidence.",
        },
      ],

      patchIntents: [
        {
          id: "intent-1",

          path: "src/components/DarkMode.test.tsx",

          objective:
            "Add the local teardown behavior required by this fixture.",

          evidenceRefs: [
            {
              kind: "FILE" as const,

              source: "src/components/DarkMode.test.tsx",
            },
          ],
        },
      ],

      confidence: "HIGH" as const,
    };

    expect(() =>
      assertInvestigationProvenance(missingFileEvidenceDiagnosis, {
        inspectedFiles: ["src/components/DarkMode.test.tsx", "vitest.setup.ts"],

        executedTests: [],
        searchQueries: [],
      }),
    ).toThrow(/has no FILE evidence observation/i);
  });
});

it("accepts TEST evidence from trusted baseline execution", () => {
  expect(() =>
    assertInvestigationProvenance(
      {
        ...diagnosis,

        evidence: [
          ...diagnosis.evidence,

          {
            kind: "TEST" as const,
            source: "npm test",
            observation:
              "The trusted baseline reproduction failed with the reported symptom.",
          },
        ],
      },

      {
        inspectedFiles: ["vitest.setup.ts"],

        executedTests: [],

        searchQueries: [],

        trustedTestCommands: ["npm test"],
      },
    ),
  ).not.toThrow();
});
