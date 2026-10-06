import { describe, expect, it } from "vitest";

import type { InvestigationDiagnosis } from "./investigation-contract.js";

import { assertPatchIntentContract } from "./investigation-intents.js";

const diagnosis = {
  rootCause: "Shared test cleanup is missing.",

  evidence: [
    {
      kind: "FILE",
      source: "vitest.setup.ts",
      observation: "The shared setup does not register cleanup.",
    },

    {
      kind: "TEST",
      source: "npm test",
      observation:
        "The trusted baseline shows DOM from previous tests remains mounted.",
    },
  ],

  relevantFiles: ["vitest.setup.ts"],

  recommendedPatchTargets: ["vitest.setup.ts"],

  patchTargetAnalysis: [
    {
      path: "vitest.setup.ts",
      decision: "RECOMMEND",
      reason:
        "The shared setup controls the lifecycle for the affected tests.",
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
        {
          kind: "TEST",
          source: "npm test",
        },
      ],
    },
  ],

  confidence: "HIGH",
} satisfies InvestigationDiagnosis;

describe("assertPatchIntentContract", () => {
  it("accepts a grounded patch intent", () => {
    expect(() => assertPatchIntentContract(diagnosis)).not.toThrow();
  });

  it("rejects duplicate intent ids", () => {
    expect(() =>
      assertPatchIntentContract({
        ...diagnosis,
        patchIntents: [
          ...diagnosis.patchIntents,
          {
            ...diagnosis.patchIntents[0]!,
          },
        ],
      }),
    ).toThrow(/duplicate patch intent id/i);
  });

  it("rejects an intent for a non-recommended path", () => {
    expect(() =>
      assertPatchIntentContract({
        ...diagnosis,
        patchIntents: [
          {
            id: "intent-1",
            path: "src/example.ts",
            objective: "Change unrelated application behavior.",
            evidenceRefs: [
              {
                kind: "TEST",
                source: "npm test",
              },
            ],
          },
        ],
      }),
    ).toThrow(/not present in recommendedPatchTargets/i);
  });

  it("rejects unknown evidence references", () => {
    expect(() =>
      assertPatchIntentContract({
        ...diagnosis,
        patchIntents: [
          {
            ...diagnosis.patchIntents[0]!,
            evidenceRefs: [
              {
                kind: "FILE",
                source: "src/made-up.ts",
              },
            ],
          },
        ],
      }),
    ).toThrow(/does not exist in diagnosis\.evidence/i);
  });

  it("requires every recommended target to have an intent", () => {
    expect(() =>
      assertPatchIntentContract({
        ...diagnosis,
        patchIntents: [],
      }),
    ).toThrow(/has no patch intent/i);
  });

  it("rejects intents for targets not marked RECOMMEND", () => {
    expect(() =>
      assertPatchIntentContract({
        ...diagnosis,
        patchTargetAnalysis: [
          {
            path: "vitest.setup.ts",
            decision: "REJECT",
            reason:
              "This fixture intentionally rejects the target for validation.",
          },
        ],
      }),
    ).toThrow(/not marked RECOMMEND/i);
  });
});
