import { describe, expect, it } from "vitest";

import type { InvestigationModelOutput } from "./investigation-contract.js";
import { ensureTrustedBaselineEvidence } from "./investigation-baseline-evidence.js";

const baseline = {
  command: "npm test",
  exitCode: 1,
  reproduced: true as const,
  requiredOutput: ["Found multiple elements"],
  outputExcerpt: "Found multiple elements",
};

const structured = {
  report: "The failure is caused by shared test setup behavior.",
  diagnosis: {
    rootCause: "Shared test cleanup is missing.",
    scopeAnalysis: {
      scope: "SHARED",
      reason:
        "The trusted baseline shows state persisting across the shared test environment.",
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
        observation: "The setup file does not register cleanup.",
      },
    ],
    relevantFiles: ["vitest.setup.ts"],
    recommendedPatchTargets: ["vitest.setup.ts"],
    patchTargetAnalysis: [
      {
        path: "vitest.setup.ts",
        decision: "RECOMMEND",
        reason:
          "The shared setup is the smallest evidence-supported repair location.",
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
  },
} satisfies InvestigationModelOutput;

describe("ensureTrustedBaselineEvidence", () => {
  it("adds trusted baseline evidence when the diagnosis already references it", () => {
    const result = ensureTrustedBaselineEvidence(structured, baseline);

    expect(result.diagnosis.evidence).toContainEqual({
      kind: "TEST",
      source: "npm test",
      observation:
        "Trusted baseline reproduction exited with code 1 and reproduced the reported issue.",
    });
  });

  it("does not duplicate baseline evidence that is already present", () => {
    const once = ensureTrustedBaselineEvidence(structured, baseline);
    const twice = ensureTrustedBaselineEvidence(once, baseline);

    expect(
      twice.diagnosis.evidence.filter(
        (evidence) =>
          evidence.kind === "TEST" && evidence.source === "npm test",
      ),
    ).toHaveLength(1);
  });

  it("does not add baseline evidence when no contract section references it", () => {
    const withoutReference: InvestigationModelOutput = {
      ...structured,
      diagnosis: {
        ...structured.diagnosis,
        scopeAnalysis: {
          ...structured.diagnosis.scopeAnalysis,
          evidenceRefs: [
            {
              kind: "FILE",
              source: "vitest.setup.ts",
            },
          ],
        },
      },
    };

    expect(
      ensureTrustedBaselineEvidence(withoutReference, baseline),
    ).toBe(withoutReference);
  });
});
