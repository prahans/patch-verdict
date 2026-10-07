import { describe, expect, it } from "vitest";
import { assertRepairAlternatives, repairPlanOutputSchema, type ReadyRepairPlan } from "./repair-plan.js";
import { causalFixture, blockedRepairFixture } from "./test-fixtures/causal.js";

function fixture() {
  const { planOutput, causalEvidence } = causalFixture();
  return { output: repairPlanOutputSchema.parse(planOutput) as ReadyRepairPlan, evidence: causalEvidence };
}

describe("separate repair decision contract", () => {
  it("compares a selected patch with the explicitly rejected no-change option", () => {
    const { output, evidence } = fixture();
    expect(() => assertRepairAlternatives(output, evidence)).not.toThrow();
  });

  it.each(["duplicate id", "duplicate choice", "two selected", "no selected", "unknown selection", "uninspected target", "truncated target", "missing own file", "missing evidence", "missing ledger", "different objective", "different repair kind", "different target", "multiple intents", "multiple targets", "inconsistent no-change"])(
    "rejects %s before authorizing the patch", (invalid) => {
      const { output, evidence } = fixture();
      const selected = output.alternatives[0]!;
      if (invalid === "duplicate id") output.alternatives[1]!.id = selected.id;
      if (invalid === "duplicate choice") output.alternatives[1] = { ...selected, id: "option-2", decision: "REJECTED" };
      if (invalid === "two selected") output.alternatives[1]!.decision = "SELECTED";
      if (invalid === "no selected") selected.decision = "REJECTED";
      if (invalid === "unknown selection") output.selectedAlternativeId = "option-3";
      if (invalid === "uninspected target") selected.path = "unseen.ts";
      if (invalid === "truncated target") evidence.files[0]!.truncated = true;
      if (invalid === "missing own file") selected.evidenceRefs = [{ kind: "TEST", source: "npm test" }];
      if (invalid === "missing evidence") selected.evidenceRefs.push({ kind: "EXPERIMENT", source: "EXP-999" });
      if (invalid === "missing ledger") output.plan.evidence = output.plan.evidence.filter((ref) => ref.kind !== "TEST");
      if (invalid === "different objective") output.plan.patchIntents[0]!.objective = "Change a different behavior in the function.";
      if (invalid === "different repair kind") output.plan.patchIntents[0]!.repairKind = "MITIGATION";
      if (invalid === "different target") output.plan.recommendedPatchTargets[0] = "tests/divide.test.ts";
      if (invalid === "multiple intents") output.plan.patchIntents.push({ ...output.plan.patchIntents[0]!, id: "intent-2" });
      if (invalid === "multiple targets") output.plan.recommendedPatchTargets.push("tests/divide.test.ts");
      if (invalid === "inconsistent no-change") output.alternatives[1]!.repairKind = "MITIGATION";
      expect(() => assertRepairAlternatives(output, evidence)).toThrow();
    },
  );

  it("does not let a blocked plan smuggle in a selection or executable plan", () => {
    const { evidence } = fixture();
    const blocked = blockedRepairFixture();
    expect(() => assertRepairAlternatives(repairPlanOutputSchema.parse(blocked), evidence)).not.toThrow();
    blocked.alternatives[0]!.decision = "SELECTED";
    expect(() => assertRepairAlternatives(repairPlanOutputSchema.parse(blocked), evidence)).toThrow(/BLOCKED/);
    expect(() => repairPlanOutputSchema.parse({ ...blocked, plan: causalFixture().planOutput.plan })).toThrow();
  });

  it("requires a comparison for READY and keeps verification commands host-owned", () => {
    const { output } = fixture();
    expect(() => repairPlanOutputSchema.parse({ ...output, alternatives: [output.alternatives[0]] })).toThrow();
    expect(() => repairPlanOutputSchema.parse({ ...output, verification: { command: "true" } })).toThrow();
  });
});
