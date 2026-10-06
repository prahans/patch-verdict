import { describe, expect, it } from "vitest";

import {
  assertHypothesisBoardGrounding,
  hypothesisBoardSchema,
  parseHypothesisBoard,
  type HypothesisBoard,
} from "./hypothesis-board.js";

const board = {
  observedFailure:
    "The baseline test run shows rendered DOM from earlier tests remaining visible to later DarkMode assertions.",

  hypotheses: [
    {
      id: "H1",
      layer: "DEPENDENCY_RUNTIME",
      hypothesis:
        "The test runtime lifecycle does not preserve automatic Testing Library cleanup registration across the observed suite execution mode.",
      status: "OPEN",
      supportingEvidenceRefs: [
        {
          kind: "TEST",
          source: "npm test",
        },
        {
          kind: "FILE",
          source: "package.json",
        },
      ],
      contradictingEvidenceRefs: [],
      missingEvidence: [
        "A controlled execution that changes the relevant runtime/isolation condition.",
      ],
    },
    {
      id: "H2",
      layer: "CONFIGURATION",
      hypothesis:
        "The active Vitest configuration creates an execution mode that allows lifecycle state to persist across suites.",
      status: "OPEN",
      supportingEvidenceRefs: [
        {
          kind: "FILE",
          source: "vite.config.ts",
        },
      ],
      contradictingEvidenceRefs: [],
      missingEvidence: [
        "Evidence that changing the relevant configuration changes the failing outcome.",
      ],
    },
    {
      id: "H3",
      layer: "TEST_INFRASTRUCTURE",
      hypothesis:
        "The repository shared test setup itself fails to register cleanup required by these tests.",
      status: "OPEN",
      supportingEvidenceRefs: [
        {
          kind: "FILE",
          source: "vitest.setup.ts",
        },
      ],
      contradictingEvidenceRefs: [],
      missingEvidence: [
        "Evidence distinguishing missing repository setup from runtime hook behavior.",
      ],
    },
  ],

  discriminationGoal: {
    question:
      "Does the failure follow the runtime/configuration execution mode, or does it persist because the repository test setup independently lacks required lifecycle behavior?",
    competingHypothesisIds: ["H1", "H2", "H3"],
    evidenceNeeded:
      "A controlled observation that changes one causal variable while preserving the same failing tests.",
  },
} satisfies HypothesisBoard;

const grounding = {
  baselineCommand: "npm test",
  preInspectedFiles: [
    "package.json",
    "vite.config.ts",
    "vitest.setup.ts",
    "src/components/DarkMode.test.tsx",
  ],
};

describe("Hypothesis Board v4", () => {
  it("accepts a grounded multi-hypothesis board", () => {
    expect(() =>
      assertHypothesisBoardGrounding(board, grounding),
    ).not.toThrow();
  });

  it("round-trips a valid structured board", () => {
    expect(parseHypothesisBoard(JSON.stringify(board))).toEqual(board);
  });

  it("requires at least two competing hypotheses", () => {
    expect(() =>
      hypothesisBoardSchema.parse({
        ...board,
        hypotheses: [board.hypotheses[0]],
      }),
    ).toThrow();
  });

  it("rejects evidence that deterministic reconnaissance did not inspect", () => {
    expect(() =>
      assertHypothesisBoardGrounding(
        {
          ...board,
          hypotheses: [
            {
              ...board.hypotheses[0]!,
              supportingEvidenceRefs: [
                {
                  kind: "FILE",
                  source: "src/unseen.ts",
                },
              ],
            },
            ...board.hypotheses.slice(1),
          ],
        },
        grounding,
      ),
    ).toThrow(/was not available from the trusted baseline or deterministic reconnaissance/i);
  });

  it("rejects the same evidence as both supporting and contradicting", () => {
    expect(() =>
      assertHypothesisBoardGrounding(
        {
          ...board,
          hypotheses: [
            {
              ...board.hypotheses[0]!,
              contradictingEvidenceRefs: [
                {
                  kind: "TEST",
                  source: "npm test",
                },
              ],
            },
            ...board.hypotheses.slice(1),
          ],
        },
        grounding,
      ),
    ).toThrow(/both supporting and contradicting evidence/i);
  });

  it("rejects duplicate hypothesis ids", () => {
    expect(() =>
      assertHypothesisBoardGrounding(
        {
          ...board,
          hypotheses: [
            board.hypotheses[0]!,
            {
              ...board.hypotheses[1]!,
              id: "H1",
            },
          ],
          discriminationGoal: {
            ...board.discriminationGoal,
            competingHypothesisIds: ["H1", "H2"],
          },
        },
        grounding,
      ),
    ).toThrow(/Duplicate hypothesis id/i);
  });

  it("rejects discrimination goals that reference unknown hypotheses", () => {
    expect(() =>
      assertHypothesisBoardGrounding(
        {
          ...board,
          discriminationGoal: {
            ...board.discriminationGoal,
            competingHypothesisIds: ["H1", "H5"],
          },
        },
        grounding,
      ),
    ).toThrow(/unknown hypothesis id "H5"/i);
  });

  it("rejects repair-oriented fields in the causal board", () => {
    expect(() =>
      hypothesisBoardSchema.parse({
        ...board,
        recommendedPatchTargets: ["vitest.setup.ts"],
      }),
    ).toThrow();
  });
});
