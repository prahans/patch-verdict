import { beforeEach, describe, expect, it, vi } from "vitest";
import { planRepair } from "./plan-repair.js";
import { causalFixture, deferredFreeze, modelResponse, toolResponse } from "./test-fixtures/causal.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../ai/openrouter.js", () => ({ AGENT_MODEL: "test", openRouter: { chat: { send } } }));

describe("repair planning after causal freeze", () => {
  beforeEach(() => send.mockReset());

  it("projects the cause from the freeze while preserving weakened alternatives", async () => {
    const { freeze, causalEvidence, planOutput, reconnaissance } = causalFixture();
    const before = structuredClone({ freeze, causalEvidence });
    send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: reconnaissance.inventory });
    expect(result.diagnosis.rootCause).toBe(freeze.causalClaim);
    expect(result.diagnosis.confidence).toBe(freeze.confidence);
    expect(result.diagnosis.rootCauseAnalysis.primaryCause).toEqual({
      layer: freeze.causeLayer, hypothesis: freeze.causalClaim,
      evidenceRefs: freeze.hypothesisAssessments[0]!.evidenceRefs,
    });
    expect(result.diagnosis.rootCauseAnalysis.alternatives[0]!.status).toBe("WEAKENED");
    expect({ freeze, causalEvidence }).toEqual(before);
    expect(send.mock.calls[0]![0].chatRequest).not.toHaveProperty("tools");
  });

  it("does not request any plan for a deferred causal decision", async () => {
    const { freeze, causalEvidence } = causalFixture();
    await expect(planRepair({ causalFreeze: deferredFreeze(freeze), causalEvidence, discoveredFiles: [] })).rejects.toThrow(/planning is blocked/);
    expect(send).not.toHaveBeenCalled();
  });

  it("revalidates a claimed FROZEN decision before requesting a plan", async () => {
    const { freeze, causalEvidence } = causalFixture();
    freeze.hypothesisAssessments[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
    await expect(planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/untrusted FILE/);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["rootCause", "rootCauseAnalysis", "confidence"])("rejects a planner-supplied %s field", async (field) => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    Object.assign(planOutput.plan, { [field]: "model replacement" });
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/failed after one no-tool repair/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("still enforces evidence provenance after the freeze gate", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    planOutput.plan.evidence.push({ kind: "FILE", source: "src/unseen.ts", observation: "invented observation" });
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/was not inspected/);
  });

  it("does not allow the plan to drop references used by the frozen cause", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    planOutput.plan.evidence = planOutput.plan.evidence.filter((entry) => entry.kind !== "TEST");
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/does not exist in investigation evidence/);
  });

  it.each(["UNRESOLVED", "SUPPORTED"] as const)("blocks ROOT_CAUSE_FIX while a competitor is %s", async (status) => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    freeze.hypothesisAssessments[1]!.status = status;
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/cannot be ROOT_CAUSE_FIX/);
  });

  it("preserves competing support in a bounded mitigation plan", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    freeze.hypothesisAssessments[1]!.status = "SUPPORTED";
    planOutput.plan.patchIntents[0]!.repairKind = "MITIGATION";
    send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] });
    expect(result.diagnosis.rootCauseAnalysis.alternatives[0]!.status).toBe("SUPPORTED");
    expect(result.diagnosis.patchIntents[0]!.repairKind).toBe("MITIGATION");
  });

  it("permits one citation repair but cannot use it to change the repair objective", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    const initial = structuredClone(planOutput);
    initial.plan.patchIntents[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
    send.mockResolvedValueOnce(modelResponse(initial));
    planOutput.plan.patchIntents[0]!.objective = "Change division to return zero for every input.";
    send.mockResolvedValueOnce(modelResponse(planOutput));
    await expect(planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/change investigation semantics/);
  });

  it("accepts a citation repair from the same observed evidence", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    const initial = structuredClone(planOutput);
    initial.plan.patchIntents[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
    send.mockResolvedValueOnce(modelResponse(initial));
    send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] });
    expect(result.diagnosis.rootCause).toBe(freeze.causalClaim);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects an unexpected tool call without executing it", async () => {
    const { freeze, causalEvidence } = causalFixture();
    send.mockResolvedValueOnce(toolResponse("apply_patch", {}));
    await expect(planRepair({ causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/cannot execute tools/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
