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

          rootCauseAnalysis: {
            failureMechanism:
              "Rendered DOM survives between tests because the shared lifecycle does not clean it.",

            primaryCause: {
              layer: "TEST_INFRASTRUCTURE",

              hypothesis:
                "The shared test setup does not register the cleanup lifecycle required by the affected tests.",

              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "vitest.setup.ts",
                },
              ],
            },

            alternatives: [],
          },

          scopeAnalysis: {
            scope: "SHARED",
            reason:
              "The missing cleanup behavior belongs to shared test lifecycle setup rather than one individual test.",
            evidenceRefs: [
              {
                kind: "FILE",
                source: "vitest.setup.ts",
              },
              {
                kind: "FILE",
                source: "src/components/DarkMode.test.tsx",
              },
            ],
          },

          evidence: [
            {
              kind: "FILE",
              source: "vitest.setup.ts",
              observation:
                "The setup file does not register Testing Library cleanup.",
            },

            {
              kind: "FILE",
              source: "src/components/DarkMode.test.tsx",
              observation:
                "The failing test renders DOM and exposes the accumulated-state symptom.",
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
              reason:
                "Changing only the failing test would address the local symptom instead of the shared test lifecycle.",
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
              repairKind: "ROOT_CAUSE_FIX",
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
        reason:
          "Changing only the failing test would address the local symptom instead of the shared test lifecycle.",
        evidenceRefs: [
          {
            kind: "FILE",
            source: "src/components/DarkMode.test.tsx",
          },
        ],
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
    "rootCauseAnalysis": {
      "failureMechanism": "The state transition writes an incorrect value.",
      "primaryCause": {
        "layer": "APPLICATION_CODE",
        "hypothesis": "The application state transition implementation writes the wrong value.",
        "evidenceRefs": [
          {
            "kind": "FILE",
            "source": "src/state.ts"
          }
        ]
      },
      "alternatives": []
    },
    "scopeAnalysis": {
      "scope": "LOCAL",
      "reason": "The incorrect transition is contained in the inspected state implementation.",
      "evidenceRefs": [
        {
          "kind": "FILE",
          "source": "src/state.ts"
        }
      ]
    },
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
        "reason": "This file contains the incorrect state transition and directly addresses the diagnosed root cause.",
        "evidenceRefs": [
          {
            "kind": "FILE",
            "source": "src/state.ts"
          }
        ]
      }
    ],
    "patchIntents": [
      {
        "id": "intent-1",
        "path": "src/state.ts",
        "objective": "Correct the incorrect state transition.",
        "repairKind": "ROOT_CAUSE_FIX",
        "evidenceRefs": [
          {
            "kind": "FILE",
            "source": "src/state.ts"
          }
        ]
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
        evidenceRefs: [
          {
            kind: "FILE",
            source: "src/state.ts",
          },
        ],
      },
    ]);

    expect(result.diagnosis.patchIntents).toEqual([
      {
        id: "intent-1",
        path: "src/state.ts",
        objective: "Correct the incorrect state transition.",
        repairKind: "ROOT_CAUSE_FIX",
        evidenceRefs: [
          {
            kind: "FILE",
            source: "src/state.ts",
          },
        ],
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

            rootCauseAnalysis: {
              failureMechanism:
                "The example fixture exhibits a failure mechanism used for schema validation.",

              primaryCause: {
                layer: "UNKNOWN",

                hypothesis:
                  "The fixture intentionally leaves the underlying cause unresolved.",

                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
              },

              alternatives: [],
            },

            scopeAnalysis: {
              scope: "UNKNOWN",

              reason:
                "This fixture does not establish whether the example defect is local or shared.",

              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "src/example.ts",
                },
              ],
            },

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

                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
              },
            ],

            patchIntents: [
              {
                id: "intent-1",
                path: "src/example.ts",
                objective:
                  "Keep the remaining fixture structurally valid while testing absolute target rejection.",
                repairKind: "MITIGATION",
                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
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

            rootCauseAnalysis: {
              failureMechanism:
                "The example fixture exhibits a failure mechanism used for schema validation.",

              primaryCause: {
                layer: "UNKNOWN",

                hypothesis:
                  "The fixture intentionally leaves the underlying cause unresolved.",

                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
              },

              alternatives: [],
            },

            scopeAnalysis: {
              scope: "UNKNOWN",

              reason:
                "This fixture does not establish whether the example defect is local or shared.",

              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "src/example.ts",
                },
              ],
            },

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

                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
              },
            ],

            patchIntents: [
              {
                id: "intent-1",
                path: "src/example.ts",
                objective:
                  "Keep the remaining fixture structurally valid while testing path traversal rejection.",
                repairKind: "MITIGATION",
                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
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

            rootCauseAnalysis: {
              failureMechanism:
                "The fixture intentionally lacks evidence required to explain the failure mechanism.",

              primaryCause: {
                layer: "UNKNOWN",

                hypothesis:
                  "The underlying cause is intentionally unresolved because evidence is missing.",

                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
              },

              alternatives: [],
            },

            scopeAnalysis: {
              scope: "UNKNOWN",

              reason:
                "This fixture intentionally lacks evidence needed to establish failure scope.",

              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "src/example.ts",
                },
              ],
            },

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

                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
              },
            ],

            patchIntents: [
              {
                id: "intent-1",
                path: "src/example.ts",
                objective:
                  "Keep the remaining fixture structurally valid while testing the missing-evidence rule.",
                repairKind: "MITIGATION",
                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "src/example.ts",
                  },
                ],
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
  it("parses a complete alternative cause entry", () => {
    const result = parseInvestigationModelOutput(
      JSON.stringify({
        report: "A competing cause remains unresolved.",

        diagnosis: {
          rootCause: "The observed failure has more than one plausible cause.",

          rootCauseAnalysis: {
            failureMechanism:
              "Rendered DOM remains mounted between affected tests.",

            primaryCause: {
              layer: "TEST_INFRASTRUCTURE",
              hypothesis:
                "The shared test setup does not register the required cleanup lifecycle.",
              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "vitest.setup.ts",
                },
              ],
            },

            alternatives: [
              {
                layer: "DEPENDENCY_RUNTIME",
                hypothesis:
                  "Runtime module caching may prevent automatic cleanup hooks from remaining active.",
                status: "UNRESOLVED",
                reason:
                  "The available repository evidence does not yet distinguish runtime hook caching from missing shared setup.",
                evidenceRefs: [
                  {
                    kind: "TEST",
                    source: "npm test",
                  },
                ],
              },
            ],
          },

          scopeAnalysis: {
            scope: "SHARED",
            reason:
              "The failure mechanism affects shared test lifecycle behavior.",
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
            {
              kind: "TEST",
              source: "npm test",
              observation: "The baseline shows rendered DOM accumulating.",
            },
          ],

          relevantFiles: ["vitest.setup.ts"],

          recommendedPatchTargets: ["vitest.setup.ts"],

          patchTargetAnalysis: [
            {
              path: "vitest.setup.ts",
              decision: "RECOMMEND",
              reason:
                "The setup file is a bounded place to restore shared cleanup behavior.",
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
              objective: "Restore cleanup behavior between affected tests.",
              repairKind: "WORKAROUND",
              evidenceRefs: [
                {
                  kind: "FILE",
                  source: "vitest.setup.ts",
                },
              ],
            },
          ],

          confidence: "MEDIUM",
        },
      }),
    );

    expect(result.diagnosis.rootCauseAnalysis.alternatives[0]?.reason).toContain(
      "does not yet distinguish",
    );
  });

  it("rejects an alternative cause that omits reason", () => {
    expect(() =>
      parseInvestigationModelOutput(
        JSON.stringify({
          report: "Invalid alternative cause.",

          diagnosis: {
            rootCause: "A competing cause was returned incompletely.",

            rootCauseAnalysis: {
              failureMechanism:
                "Rendered DOM remains mounted between affected tests.",

              primaryCause: {
                layer: "TEST_INFRASTRUCTURE",
                hypothesis:
                  "The shared setup does not register the required cleanup lifecycle.",
                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "vitest.setup.ts",
                  },
                ],
              },

              alternatives: [
                {
                  layer: "DEPENDENCY_RUNTIME",
                  hypothesis:
                    "Runtime hook registration may be affected by module caching.",
                  status: "UNRESOLVED",
                  evidenceRefs: [
                    {
                      kind: "TEST",
                      source: "npm test",
                    },
                  ],
                },
              ],
            },

            scopeAnalysis: {
              scope: "SHARED",
              reason:
                "The failure mechanism affects shared test lifecycle behavior.",
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
              {
                kind: "TEST",
                source: "npm test",
                observation: "The baseline shows rendered DOM accumulating.",
              },
            ],

            relevantFiles: ["vitest.setup.ts"],

            recommendedPatchTargets: ["vitest.setup.ts"],

            patchTargetAnalysis: [
              {
                path: "vitest.setup.ts",
                decision: "RECOMMEND",
                reason:
                  "The setup file is a bounded place to restore shared cleanup behavior.",
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
                objective: "Restore cleanup behavior between affected tests.",
                repairKind: "WORKAROUND",
                evidenceRefs: [
                  {
                    kind: "FILE",
                    source: "vitest.setup.ts",
                  },
                ],
              },
            ],

            confidence: "MEDIUM",
          },
        }),
      ),
    ).toThrow(/alternatives\[0\]\.reason/i);
  });

});
