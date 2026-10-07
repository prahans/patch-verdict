import type { CausalFreeze } from "../causal-freeze.js";
import type { CreateCausalFreezeInput } from "../create-causal-freeze.js";
import type { ReconnaissanceContext } from "../reconnaissance.js";

export function causalFixture() {
  const causalEvidence: CreateCausalFreezeInput = {
    issue: "Division by zero should throw.",
    baseline: {
      command: "npm test", exitCode: 1, reproduced: true,
      requiredOutput: ["expected to throw"], outputExcerpt: "expected to throw",
    },
    board: {
      observedFailure: "Division by zero did not throw in the trusted baseline.",
      hypotheses: [
        {
          id: "H1", layer: "APPLICATION_CODE", status: "OPEN",
          hypothesis: "The implementation does not reject a zero divisor.",
          supportingEvidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
          contradictingEvidenceRefs: [], missingEvidence: [],
        },
        {
          id: "H2", layer: "TEST_FILE", status: "OPEN",
          hypothesis: "The test does not actually pass zero as the divisor.",
          supportingEvidenceRefs: [],
          contradictingEvidenceRefs: [{ kind: "FILE", source: "tests/divide.test.ts" }],
          missingEvidence: [],
        },
      ],
      discriminationGoal: {
        question: "Does the function validate the actual divisor supplied by the test?",
        competingHypothesisIds: ["H1", "H2"],
        evidenceNeeded: "Inspect the implementation and the failing test input.",
      },
    },
    files: [
      { path: "src/divide.ts", content: "export const divide = (a, b) => a / b;", truncated: false },
      { path: "tests/divide.test.ts", content: "expect(() => divide(10, 0)).toThrow();", truncated: false },
    ],
    tests: [], experiments: [],
  };
  const freeze: CausalFreeze = {
    status: "FROZEN", selectedHypothesisId: "H1", causeLayer: "APPLICATION_CODE",
    causalClaim: "The implementation divides without validating a zero divisor.",
    confidence: "MEDIUM", unresolvedQuestions: [],
    hypothesisAssessments: [
      {
        hypothesisId: "H1", status: "SUPPORTED",
        reason: "The function has no zero-divisor check and the baseline fails.",
        evidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }, { kind: "TEST", source: "npm test" }],
      },
      {
        hypothesisId: "H2", status: "WEAKENED",
        reason: "The inspected test supplies zero as the divisor.",
        evidenceRefs: [{ kind: "FILE", source: "tests/divide.test.ts" }],
      },
    ],
  };
  const reconnaissance: ReconnaissanceContext = {
    inventory: causalEvidence.files.map((file) => file.path), inventoryDepth: 5,
    inventoryPreview: causalEvidence.files.map((file) => file.path), inventoryTruncated: false,
    failingPaths: ["tests/divide.test.ts"], runnerConfigs: [], testSetups: [],
    files: causalEvidence.files.map((file) => ({ ...file, roles: ["FAILING_FILE"] })),
    preInspectedFiles: causalEvidence.files.map((file) => file.path), readFailures: [],
  };
  const planOutput = {
    report: "Reject zero divisors in the implementation before performing division.",
    plan: {
      scopeAnalysis: {
        scope: "LOCAL", reason: "The defect is within the inspected division implementation.",
        evidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
      },
      evidence: [
        { kind: "FILE", source: "src/divide.ts", observation: "Division is performed without checking the divisor." },
        { kind: "FILE", source: "tests/divide.test.ts", observation: "The test supplies a zero divisor and expects an error." },
        { kind: "TEST", source: "npm test", observation: "The reproduction fails because division by zero does not throw." },
      ],
      relevantFiles: ["src/divide.ts", "tests/divide.test.ts"],
      recommendedPatchTargets: ["src/divide.ts"],
      patchTargetAnalysis: [{
        path: "src/divide.ts", decision: "RECOMMEND",
        reason: "The implementation owns the missing divisor validation.",
        evidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
      }],
      patchIntents: [{
        id: "intent-1", path: "src/divide.ts", repairKind: "ROOT_CAUSE_FIX",
        objective: "Reject a zero divisor before performing division.",
        evidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
      }],
    },
  };
  return { causalEvidence, freeze, reconnaissance, planOutput };
}

export function deferredFreeze(freeze: CausalFreeze): CausalFreeze {
  return {
    ...freeze, status: "NEEDS_MORE_EVIDENCE", selectedHypothesisId: null,
    causeLayer: null, causalClaim: null, confidence: null,
    unresolvedQuestions: ["Which observed behavior distinguishes the competing causes?"],
  };
}

export function modelResponse(value: unknown) {
  return { choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }] };
}

export function toolResponse(name: string, input: unknown) {
  return { choices: [{ message: {
    role: "assistant", content: null,
    toolCalls: [{ id: "call-1", type: "function", function: { name, arguments: JSON.stringify(input) } }],
  } }] };
}
