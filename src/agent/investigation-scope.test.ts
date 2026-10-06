import { describe, expect, it } from "vitest";

import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { assertFailureScopeAnalysis } from "./investigation-scope.js";

const diagnosis = {
  rootCause: "Rendered DOM persists because shared cleanup is not configured.",

  scopeAnalysis: {
    scope: "SHARED",
    reason:
      "The missing lifecycle behavior belongs to shared test setup rather than one test case.",
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
      observation: "The shared setup does not register cleanup.",
    },
    {
      kind: "FILE",
      source: "src/components/DarkMode.test.tsx",
      observation: "The test renders DOM and exposes accumulated state.",
    },
    {
      kind: "TEST",
      source: "npm test",
      observation: "The baseline fails after DOM accumulates across tests.",
    },
  ],

  relevantFiles: ["vitest.setup.ts", "src/components/DarkMode.test.tsx"],

  recommendedPatchTargets: ["vitest.setup.ts"],

  patchTargetAnalysis: [
    {
      path: "vitest.setup.ts",
      decision: "RECOMMEND",
      reason: "The shared setup owns the missing lifecycle behavior.",
      evidenceRefs: [
        {
          kind: "FILE",
          source: "vitest.setup.ts",
        },
      ],
    },
    {
      path: "src/components/DarkMode.test.tsx",
      decision: "REJECT",
      reason: "The direct test is where the symptom appears, not the shared cause.",
      evidenceRefs: [
        {
          kind: "FILE",
          source: "src/components/DarkMode.test.tsx",
        },
      ],
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

describe("assertFailureScopeAnalysis", () => {
  it("accepts a grounded shared failure scope", () => {
    expect(() => assertFailureScopeAnalysis(diagnosis)).not.toThrow();
  });

  it("rejects scope evidence that does not exist", () => {
    expect(() =>
      assertFailureScopeAnalysis({
        ...diagnosis,
        scopeAnalysis: {
          ...diagnosis.scopeAnalysis,
          evidenceRefs: [
            {
              kind: "FILE",
              source: "src/made-up.ts",
            },
          ],
        },
      }),
    ).toThrow(/does not exist in diagnosis\.evidence/i);
  });

  it("requires at least one FILE evidence reference for scope", () => {
    expect(() =>
      assertFailureScopeAnalysis({
        ...diagnosis,
        scopeAnalysis: {
          ...diagnosis.scopeAnalysis,
          evidenceRefs: [
            {
              kind: "TEST",
              source: "npm test",
            },
          ],
        },
      }),
    ).toThrow(/at least one FILE evidence/i);
  });

  it("rejects HIGH confidence when failure scope is unknown", () => {
    expect(() =>
      assertFailureScopeAnalysis({
        ...diagnosis,
        scopeAnalysis: {
          scope: "UNKNOWN",
          reason:
            "The available evidence does not distinguish local from shared scope.",
          evidenceRefs: [
            {
              kind: "FILE",
              source: "vitest.setup.ts",
            },
          ],
        },
        confidence: "HIGH",
      }),
    ).toThrow(/UNKNOWN cannot be paired with HIGH/i);
  });

  it("requires a recommended target to connect to scope evidence", () => {
    expect(() =>
      assertFailureScopeAnalysis({
        ...diagnosis,
        scopeAnalysis: {
          ...diagnosis.scopeAnalysis,
          evidenceRefs: [
            {
              kind: "FILE",
              source: "src/components/DarkMode.test.tsx",
            },
          ],
        },
      }),
    ).toThrow(/not linked to any evidence used by the SHARED failure-scope/i);
  });
});
