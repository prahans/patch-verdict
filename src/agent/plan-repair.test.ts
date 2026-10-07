import { beforeEach, describe, expect, it, vi } from "vitest";
import { planRepair, RepairPlanningBlockedError, RepairPlanningError } from "./plan-repair.js";
import { causalFixture, deferredFreeze, modelResponse, toolResponse, verificationFixture, blockedRepairFixture } from "./test-fixtures/causal.js";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("../ai/openrouter.js", () => ({ AGENT_MODEL: "test", openRouter: { chat: { send } } }));

describe("repair planning after causal freeze", () => {
  beforeEach(() => send.mockReset());

  it("projects the cause from the freeze while preserving weakened alternatives", async () => {
    const { freeze, causalEvidence, planOutput, reconnaissance } = causalFixture();
    const before = structuredClone({ freeze, causalEvidence });
    send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: reconnaissance.inventory });
    expect(result.diagnosis.rootCause).toBe(freeze.causalClaim);
    expect(result.diagnosis.confidence).toBe(freeze.confidence);
    expect(result.diagnosis.rootCauseAnalysis.primaryCause).toEqual({
      layer: freeze.causeLayer, hypothesis: freeze.causalClaim,
      evidenceRefs: freeze.hypothesisAssessments[0]!.evidenceRefs,
    });
    expect(result.diagnosis.rootCauseAnalysis.alternatives[0]!.status).toBe("WEAKENED");
    expect({ freeze, causalEvidence }).toEqual(before);
    expect(send.mock.calls[0]![0].chatRequest).not.toHaveProperty("tools");
    expect(send.mock.calls[0]![0].chatRequest.responseFormat).toMatchObject({
      type: "json_schema",
      jsonSchema: {
        name: "patchverdict_repair_plan",
        strict: true,
      },
    });
    expect(result.repairPlan.decision).toEqual(planOutput);
    expect(result.repairPlan.verification).toEqual({ reproductionCommand: "npm test", fullSuiteCommand: "npm run test:all" });
  });

  it("does not request any plan for a deferred causal decision", async () => {
    const { freeze, causalEvidence } = causalFixture();
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: deferredFreeze(freeze), causalEvidence, discoveredFiles: [] })).rejects.toThrow(/planning is blocked/);
    expect(send).not.toHaveBeenCalled();
  });

  it("revalidates a claimed FROZEN decision before requesting a plan", async () => {
    const { freeze, causalEvidence } = causalFixture();
    freeze.hypothesisAssessments[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/untrusted FILE/);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["rootCause", "rootCauseAnalysis", "confidence"])("rejects a planner-supplied %s field", async (field) => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    Object.assign(planOutput.plan, { [field]: "model replacement" });
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/failed after one no-tool repair/);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("still enforces evidence provenance after the freeze gate", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    planOutput.plan.evidence.push({ kind: "FILE", source: "src/unseen.ts", observation: "invented observation" });
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/was not inspected/);
  });

  it("does not allow the plan to drop references used by the frozen cause", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    planOutput.plan.evidence = planOutput.plan.evidence.filter((entry) => entry.kind !== "TEST");
    planOutput.alternatives[1]!.evidenceRefs = [{ kind: "FILE", source: "tests/divide.test.ts" }];
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/does not exist in investigation evidence/);
  });

  it.each(["UNRESOLVED", "SUPPORTED"] as const)("blocks ROOT_CAUSE_FIX while a competitor is %s", async (status) => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    freeze.hypothesisAssessments[1]!.status = status;
    send.mockResolvedValue(modelResponse(planOutput));
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/cannot be ROOT_CAUSE_FIX/);
  });

  it("preserves competing support in a bounded mitigation plan", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    freeze.hypothesisAssessments[1]!.status = "SUPPORTED";
    planOutput.plan.patchIntents[0]!.repairKind = "MITIGATION";
    planOutput.alternatives[0]!.repairKind = "MITIGATION";
    send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] });
    expect(result.diagnosis.rootCauseAnalysis.alternatives[0]!.status).toBe("SUPPORTED");
    expect(result.diagnosis.patchIntents[0]!.repairKind).toBe("MITIGATION");
  });

  it("binds inconsistent repeated authorization fields to the selected alternative", async () => {
    const { freeze, causalEvidence, planOutput, reconnaissance } =
      causalFixture();

    const inconsistent = structuredClone(planOutput);
    inconsistent.plan.recommendedPatchTargets[0] = "tests/divide.test.ts";
    inconsistent.plan.patchIntents[0]!.path = "tests/divide.test.ts";
    inconsistent.plan.patchIntents[0]!.repairKind = "MITIGATION";
    inconsistent.plan.patchIntents[0]!.objective =
      "Change a different behavior in the test file.";
    inconsistent.plan.patchTargetAnalysis[0]!.decision = "REJECT";

    send.mockResolvedValueOnce(modelResponse(inconsistent));

    const result = await planRepair({
      verificationPlan: verificationFixture,
      causalFreeze: freeze,
      causalEvidence,
      discoveredFiles: reconnaissance.inventory,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result.repairPlan.decision.status).toBe("READY");

    if (result.repairPlan.decision.status === "READY") {
      expect(result.repairPlan.decision.plan.recommendedPatchTargets).toEqual([
        "src/divide.ts",
      ]);
      expect(result.repairPlan.decision.plan.patchIntents[0]).toMatchObject({
        path: "src/divide.ts",
        repairKind: "ROOT_CAUSE_FIX",
        objective: "Reject a zero divisor before performing division.",
      });
    }
  });

  it("permits one citation repair but cannot use it to change the repair objective", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    const initial = structuredClone(planOutput);
    initial.plan.patchIntents[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
    send.mockResolvedValueOnce(modelResponse(initial));
    planOutput.plan.patchIntents[0]!.objective = "Change division to return zero for every input.";
    send.mockResolvedValueOnce(modelResponse(planOutput));
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/change investigation semantics/);
  });

  it("accepts a citation repair from the same observed evidence", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    const initial = structuredClone(planOutput);
    initial.plan.patchIntents[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
    send.mockResolvedValueOnce(modelResponse(initial));
    send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] });
    expect(result.diagnosis.rootCause).toBe(freeze.causalClaim);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("rejects an unexpected tool call without executing it", async () => {
    const { freeze, causalEvidence } = causalFixture();
    send.mockResolvedValueOnce(toolResponse("apply_patch", {}));
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/cannot execute tools/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("accepts an explicit BLOCKED decision without asking the model to invent a repair", async () => {
    const { freeze, causalEvidence } = causalFixture();
    const decision = blockedRepairFixture();
    send.mockResolvedValueOnce(modelResponse(decision));
    const error = await planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RepairPlanningBlockedError);
    expect((error as RepairPlanningBlockedError).record.decision).toEqual(decision);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not allow a contract repair to select a different repair alternative", async () => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    const invalid = structuredClone(planOutput);
    invalid.plan.patchIntents[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
    send.mockResolvedValueOnce(modelResponse(invalid));
    planOutput.selectedAlternativeId = "option-2";
    send.mockResolvedValueOnce(modelResponse(planOutput));
    await expect(planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] })).rejects.toThrow(/change the repair choice/);
  });

  it.each(["initial", "repair"])("retains the %s request failure and any rejected plan", async (phase) => {
    const { freeze, causalEvidence, planOutput } = causalFixture();
    if (phase === "repair") {
      planOutput.plan.patchIntents[0]!.evidenceRefs = [{ kind: "FILE", source: "unseen.ts" }];
      send.mockResolvedValueOnce(modelResponse(planOutput));
    }
    send.mockRejectedValueOnce(new Error("model unavailable"));
    const error = await planRepair({ verificationPlan: verificationFixture, causalFreeze: freeze, causalEvidence, discoveredFiles: [] }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(RepairPlanningError);
    const attempts = (error as RepairPlanningError).failure.attempts;
    expect(attempts).toHaveLength(phase === "initial" ? 1 : 2);
    expect(attempts.at(-1)).toEqual({ responseText: null, error: "model unavailable" });
    if (phase === "repair") expect(attempts[0]!.responseText).toBe(JSON.stringify(planOutput));
    expect(send).toHaveBeenCalledTimes(attempts.length);
  });
});
