import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CausalFreeze } from "./causal-freeze.js";
import { createCausalFreeze, type CreateCausalFreezeInput } from "./create-causal-freeze.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("../ai/openrouter.js", () => ({
  AGENT_MODEL: "test-model",
  openRouter: { chat: { send } },
}));

function fixture() {
  const input: CreateCausalFreezeInput = {
    issue: "Division by zero should throw an error.",
    board: {
      observedFailure: "The trusted test reports that division by zero did not throw.",
      hypotheses: [
        {
          id: "H1",
          layer: "APPLICATION_CODE",
          hypothesis: "The implementation does not check whether the divisor is zero.",
          status: "OPEN",
          supportingEvidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
          contradictingEvidenceRefs: [],
          missingEvidence: [],
        },
        {
          id: "H2",
          layer: "TEST_FILE",
          hypothesis: "The failing test supplies an incorrect divisor to the implementation.",
          status: "OPEN",
          supportingEvidenceRefs: [],
          contradictingEvidenceRefs: [{ kind: "FILE", source: "tests/divide.test.ts" }],
          missingEvidence: [],
        },
      ],
      discriminationGoal: {
        question: "Does the failure arise from the implementation or the test input?",
        competingHypothesisIds: ["H1", "H2"],
        evidenceNeeded: "Inspect the division implementation and the failing test input.",
      },
    },
    baseline: {
      command: "npm test",
      exitCode: 1,
      reproduced: true,
      requiredOutput: ["expected function to throw"],
      outputExcerpt: "rejects division by zero: expected function to throw",
    },
    files: [
      { path: "src/divide.ts", content: "export const divide = (a, b) => a / b;", truncated: false },
      { path: "tests/divide.test.ts", content: "expect(() => divide(10, 0)).toThrow();", truncated: false },
    ],
    tests: [],
    experiments: [],
  };

  const freeze: CausalFreeze = {
    status: "FROZEN",
    hypothesisAssessments: [
      {
        hypothesisId: "H1",
        status: "SUPPORTED",
        reason: "The inspected implementation performs division without validating the divisor.",
        evidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
      },
      {
        hypothesisId: "H2",
        status: "WEAKENED",
        reason: "The observed test passes the expected zero divisor to the implementation.",
        evidenceRefs: [{ kind: "FILE", source: "tests/divide.test.ts" }],
      },
    ],
    selectedHypothesisId: "H1",
    causeLayer: "APPLICATION_CODE",
    causalClaim: "The division implementation does not validate a zero divisor.",
    confidence: "MEDIUM",
    unresolvedQuestions: [],
  };

  return { input, freeze };
}

function completion(value: unknown) {
  return {
    choices: [{ message: { role: "assistant", content: JSON.stringify(value) } }],
  };
}

function invalidCitation(freeze: CausalFreeze): CausalFreeze {
  const invalid = structuredClone(freeze);
  invalid.hypothesisAssessments[0]!.evidenceRefs = [{ kind: "FILE", source: "src/unseen.ts" }];
  return invalid;
}

describe("createCausalFreeze", () => {
  beforeEach(() => send.mockReset());

  it("creates a grounded decision from host records with no tools or repair contract", async () => {
    const { input, freeze } = fixture();
    const before = structuredClone(input);
    send.mockResolvedValueOnce(completion(freeze));

    expect(await createCausalFreeze(input)).toEqual(freeze);
    expect(input).toEqual(before);
    expect(send).toHaveBeenCalledTimes(1);

    const request = send.mock.calls[0]![0].chatRequest;
    expect(request).not.toHaveProperty("tools");
    expect(request.stream).toBe(false);
    const content = request.messages.map((message: { content: string }) => message.content).join("\n");
    expect(content).toContain(input.files[0]!.content);
    expect(content).toContain(input.baseline.outputExcerpt);
    expect(content).toContain("No tools are available");
    expect(content).toContain("untrusted data");
    expect(content).not.toContain('"recommendedPatchTargets"');
    expect(content).not.toContain('"patchIntents"');
  });

  it("returns NEEDS_MORE_EVIDENCE without trying to turn uncertainty into a freeze", async () => {
    const { input, freeze } = fixture();
    const deferred: CausalFreeze = {
      ...freeze,
      status: "NEEDS_MORE_EVIDENCE",
      selectedHypothesisId: null,
      causeLayer: null,
      causalClaim: null,
      confidence: null,
      unresolvedQuestions: ["What behavior does the documented division contract require?"],
    };
    send.mockResolvedValueOnce(completion(deferred));

    expect(await createCausalFreeze(input)).toEqual(deferred);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("repairs malformed JSON once without exposing tools", async () => {
    const { input, freeze } = fixture();
    send.mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "bad json" } }] });
    send.mockResolvedValueOnce(completion(freeze));

    expect(await createCausalFreeze(input)).toEqual(freeze);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].chatRequest).not.toHaveProperty("tools");
  });

  it("repairs a citation using existing evidence without changing causal semantics", async () => {
    const { input, freeze } = fixture();
    send.mockResolvedValueOnce(completion(invalidCitation(freeze)));
    send.mockResolvedValueOnce(completion(freeze));

    expect(await createCausalFreeze(input)).toEqual(freeze);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("allows harmless assessment ordering and explanatory-reason changes during repair", async () => {
    const { input, freeze } = fixture();
    send.mockResolvedValueOnce(completion(invalidCitation(freeze)));
    freeze.hypothesisAssessments.reverse();
    freeze.hypothesisAssessments[0]!.reason = "The inspected test uses a zero divisor as required by the reported issue.";
    send.mockResolvedValueOnce(completion(freeze));

    expect(await createCausalFreeze(input)).toEqual(freeze);
  });

  it.each(["selection", "claim", "confidence", "assessment", "questions", "decision"])(
    "rejects changing %s during a no-tool contract repair", async (change) => {
      const { input, freeze } = fixture();
      send.mockResolvedValueOnce(completion(invalidCitation(freeze)));
      if (change === "selection") {
        freeze.selectedHypothesisId = "H2";
        freeze.causeLayer = "TEST_FILE";
        freeze.hypothesisAssessments[1]!.status = "SUPPORTED";
      }
      if (change === "claim") freeze.causalClaim = "The test runtime changed the behavior of division.";
      if (change === "confidence") freeze.confidence = "HIGH";
      if (change === "assessment") freeze.hypothesisAssessments[1]!.status = "UNRESOLVED";
      if (change === "questions") freeze.unresolvedQuestions = ["Does runtime behavior affect the observed failure?"];
      if (change === "decision") {
        freeze.status = "NEEDS_MORE_EVIDENCE";
        freeze.selectedHypothesisId = null;
        freeze.causeLayer = null;
        freeze.causalClaim = null;
        freeze.confidence = null;
        freeze.unresolvedQuestions = ["What causal evidence is still missing?"];
      }
      send.mockResolvedValueOnce(completion(freeze));

      await expect(createCausalFreeze(input)).rejects.toThrow(/change causal semantics/);
      expect(send).toHaveBeenCalledTimes(2);
    },
  );

  it("fails closed after two invalid responses instead of retrying until something passes", async () => {
    const { input, freeze } = fixture();
    send.mockResolvedValue(completion(invalidCitation(freeze)));

    await expect(createCausalFreeze(input)).rejects.toThrow(/failed after one no-tool repair/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not trust model-supplied records added to the decision", async () => {
    const { input, freeze } = fixture();
    send.mockResolvedValue(completion({
      ...invalidCitation(freeze),
      trustedEvidence: [{ kind: "FILE", source: "src/unseen.ts" }],
    }));

    await expect(createCausalFreeze(input)).rejects.toThrow(/structured contract/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("binds the evidence allowlist to the snapshot seen by the model", async () => {
    const { input, freeze } = fixture();
    send.mockImplementationOnce(async () => {
      input.files = [...input.files, { path: "src/unseen.ts", content: "new observation", truncated: false }];
      return completion(invalidCitation(freeze));
    });
    send.mockResolvedValueOnce(completion(invalidCitation(freeze)));

    await expect(createCausalFreeze(input)).rejects.toThrow(/untrusted FILE evidence "src\/unseen.ts"/);
  });

  it("grounds references in actual recorded test selectors and commands", async () => {
    const { input, freeze } = fixture();
    input.tests = [{
      selector: "rejects division by zero",
      evidence: { command: "vitest run -t 'rejects division by zero'", exitCode: 1, stdout: "failure", stderr: "", durationMs: 4 },
    }];
    freeze.hypothesisAssessments[0]!.evidenceRefs = [
      { kind: "TEST", source: input.tests[0]!.selector },
      { kind: "TEST", source: input.tests[0]!.evidence.command },
      { kind: "TEST", source: input.baseline.command },
    ];
    send.mockResolvedValueOnce(completion(freeze));

    expect(await createCausalFreeze(input)).toEqual(freeze);
  });

  it("rejects unexecuted experiment references even if the model supplies a plausible reason", async () => {
    const { input, freeze } = fixture();
    freeze.hypothesisAssessments[0]!.evidenceRefs = [{ kind: "EXPERIMENT", source: "EXP-1" }];
    send.mockResolvedValue(completion(freeze));

    await expect(createCausalFreeze(input)).rejects.toThrow(/was not executed/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("supplies successful experiment records to both the model and grounding validator", async () => {
    const { input, freeze } = fixture();
    input.experiments = [{
      experimentId: "EXP-1",
      evidenceSource: "EXP-1",
      hypothesisIds: ["H1", "H2"],
      question: "Does the reproduced failure persist under another runner mode?",
      intervention: { path: "vite.config.ts", role: "RUNNER_CONFIGURATION", find: "threads: false", replace: "threads: true" },
      command: { command: "npm test", exitCode: 1, stdout: "expected function to throw", stderr: "", durationMs: 5 },
      outcome: "FAILURE_PERSISTS",
      repositoryRestored: true,
    }];
    freeze.hypothesisAssessments[0]!.evidenceRefs.push({ kind: "EXPERIMENT", source: "EXP-1" });
    send.mockResolvedValueOnce(completion(freeze));

    expect(await createCausalFreeze(input)).toEqual(freeze);
    expect(send.mock.calls[0]![0].chatRequest.messages[1].content).toContain('"FAILURE_PERSISTS"');
  });

  it.each(["initial", "repair"])("rejects unsolicited tool calls in the %s response", async (phase) => {
    const { input, freeze } = fixture();
    if (phase === "repair") send.mockResolvedValueOnce(completion(invalidCitation(freeze)));
    send.mockResolvedValueOnce({
      choices: [{ message: {
        role: "assistant",
        content: JSON.stringify(freeze),
        toolCalls: [{ id: "call-1", type: "function", function: { name: "apply_patch", arguments: "{}" } }],
      } }],
    });

    await expect(createCausalFreeze(input)).rejects.toThrow(/unexpected tool calls were rejected/);
    expect(send).toHaveBeenCalledTimes(phase === "repair" ? 2 : 1);
  });

  it.each([
    { response: {}, error: /non-streaming/ },
    { response: { choices: [] }, error: /no causal-freeze response/ },
  ])("rejects an unusable model response: $error", async ({ response, error }) => {
    const { input } = fixture();
    send.mockResolvedValueOnce(response);

    await expect(createCausalFreeze(input)).rejects.toThrow(error);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
