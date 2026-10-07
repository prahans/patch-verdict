import { beforeEach, describe, expect, it, vi } from "vitest";

import { proposeExperiments } from "./propose-experiments.js";
import { experimentFixture, modelResponse } from "./test-fixtures/causal.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("../ai/openrouter.js", () => ({
  AGENT_MODEL: "test-model",
  openRouter: { chat: { send } },
}));

describe("host experiment proposer", () => {
  beforeEach(() => send.mockReset());

  it("uses structured output and no tools for bounded experiment planning", async () => {
    const { fixture, proposal } = experimentFixture();
    send.mockResolvedValueOnce(modelResponse(proposal));

    expect(
      await proposeExperiments({
        evidence: fixture.causalEvidence,
        runnerConfigPaths: fixture.reconnaissance.runnerConfigs,
        testSetupPaths: fixture.reconnaissance.testSetups,
        previousPlans: [],
      }),
    ).toEqual(proposal);

    const request = send.mock.calls[0]![0].chatRequest;

    expect(request).not.toHaveProperty("tools");
    expect(request.responseFormat).toMatchObject({
      type: "json_schema",
      jsonSchema: {
        name: "patchverdict_experiment_proposal",
        strict: true,
      },
    });
  });

  it("requires a direct boolean runner toggle named by a hypothesis", async () => {
    const { fixture, proposal } = experimentFixture();

    fixture.causalEvidence.board.hypotheses[0]!.hypothesis =
      "The runner setting threads: false causes the reproduced lifecycle failure.";

    const substitute = structuredClone(proposal);
    substitute.candidates[0]!.find = "threads: false";
    substitute.candidates[0]!.replace = "threads: false, isolate: true";

    send.mockResolvedValueOnce(modelResponse(substitute));
    send.mockResolvedValueOnce(modelResponse(proposal));

    const result = await proposeExperiments({
      evidence: fixture.causalEvidence,
      runnerConfigPaths: fixture.reconnaissance.runnerConfigs,
      testSetupPaths: fixture.reconnaissance.testSetups,
      previousPlans: [],
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(result.candidates[0]).toMatchObject({
      path: "vite.config.ts",
      find: "threads: false",
      replace: "threads: true",
    });

    const repairRequest =
      send.mock.calls[1]![0].chatRequest.messages.at(-1)?.content;

    expect(repairRequest).toContain("threads: false");
    expect(repairRequest).toContain("threads: true");
  });
  it("passes unresolved causal questions into a bounded follow-up planning request", async () => {
    const { fixture, proposal } = experimentFixture();
    send.mockResolvedValueOnce(modelResponse(proposal));

    await proposeExperiments({
      evidence: fixture.causalEvidence,
      runnerConfigPaths: fixture.reconnaissance.runnerConfigs,
      testSetupPaths: fixture.reconnaissance.testSetups,
      previousPlans: [],
      focusQuestions: ["Does runner isolation change the reproduced failure?"],
    });

    const body = JSON.parse(send.mock.calls[0]![0].chatRequest.messages[1].content);
    expect(body.focusQuestions).toEqual([
      "Does runner isolation change the reproduced failure?",
    ]);
  });
});
