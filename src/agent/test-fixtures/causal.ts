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
    status: "READY",
    selectedAlternativeId: "option-1",
    blockers: [],
    alternatives: [
      {
        id: "option-1", path: "src/divide.ts", repairKind: "ROOT_CAUSE_FIX",
        objective: "Reject a zero divisor before performing division.", decision: "SELECTED",
        reason: "This changes the implementation that owns the missing validation.",
        tradeoff: "The function will throw on zero while preserving nonzero division behavior.",
        evidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
      },
      {
        id: "option-2", path: null, repairKind: null,
        objective: "Leave the existing division implementation unchanged.", decision: "REJECTED",
        reason: "The reproduced zero-divisor defect would remain unresolved.",
        tradeoff: "Avoids a behavior change but leaves the reported failure in place.",
        evidenceRefs: [{ kind: "TEST", source: "npm test" }],
      },
    ],
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

export const verificationFixture = {
  reproduction: { label: "Reproduce", command: "npm test", expectation: { expectedExitCodes: [1], requiredOutput: ["expected to throw"] } },
  fullSuite: { label: "Full suite", command: "npm run test:all" },
};

export function blockedRepairFixture() {
  const { planOutput } = causalFixture();
  return {
    status: "BLOCKED", report: "The current executor cannot apply the required coordinated repair.",
    selectedAlternativeId: null, plan: null,
    alternatives: [planOutput.alternatives[1]!],
    blockers: ["The required repair spans multiple files; the executor authorizes one file."],
  };
}

export function experimentFixture(fixture = causalFixture()) {
  const file = { path: "vite.config.ts", content: "export default { test: { threads: false } };", truncated: false };
  fixture.causalEvidence.files = [...fixture.causalEvidence.files, file];
  fixture.reconnaissance.files.push({ ...file, roles: ["RUNNER_CONFIG"] });
  fixture.reconnaissance.preInspectedFiles.push(file.path);
  fixture.reconnaissance.inventory.push(file.path);
  fixture.reconnaissance.runnerConfigs.push(file.path);
  fixture.planOutput.plan.evidence.push({ kind: "FILE", source: file.path, observation: "The inspected runner configuration disables threads." });
  fixture.planOutput.plan.scopeAnalysis.evidenceRefs.push({ kind: "FILE", source: file.path });
  fixture.planOutput.plan.scopeAnalysis.reason = "The inspected implementation lacks divisor validation; the runner configuration does not implement that behavior.";
  fixture.planOutput.plan.relevantFiles.push(file.path);
  fixture.planOutput.plan.patchTargetAnalysis.push({
    path: file.path, decision: "REJECT",
    reason: "The inspected runner configuration does not own the division function's input validation.",
    evidenceRefs: [{ kind: "FILE", source: file.path }],
  });
  const proposal = {
    candidates: [{
      id: "candidate-1", question: "Does changing runner isolation distinguish the proposed causes?",
      causalVariable: "The runner's worker-isolation configuration.",
      path: file.path, find: "threads: false", replace: "threads: true",
      predictions: fixture.causalEvidence.board.hypotheses.map((hypothesis, i) => ({
        hypothesisId: hypothesis.id, expectedOutcome: i === 0 ? "FAILURE_PERSISTS" : "FAILURE_REMOVED",
        reason: "Synthetic prediction grounded in the recorded baseline and configuration.",
        evidenceRefs: [{ kind: "TEST", source: "npm test" }],
      })),
    }], stopReason: null,
  };
  return { fixture, proposal };
}
