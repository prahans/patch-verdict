import { describe, expect, it } from "vitest";
import { planExperiments, predictedInformationGain, type ExperimentCandidate, type ExperimentPlanningContext } from "./experiment-planner.js";
import { experimentFixture } from "./test-fixtures/causal.js";

function setup() {
  const { fixture, proposal } = experimentFixture();
  const context: ExperimentPlanningContext = {
    evidence: fixture.causalEvidence, runnerConfigPaths: fixture.reconnaissance.runnerConfigs,
    testSetupPaths: [], previousPlans: [], remainingExecutions: 2, maxPlanningRounds: 3, nextExperimentId: "EXP-1",
  };
  return { context, proposal };
}

describe("experiment information-gain planner", () => {
  it("selects the discriminating intervention instead of a symptom control", () => {
    const { context, proposal } = setup();
    const control = structuredClone(proposal.candidates[0]!);
    control.id = "candidate-2";
    control.replace = "threads: true, isolate: true";
    control.predictions.forEach((prediction) => { prediction.expectedOutcome = "FAILURE_REMOVED"; });
    proposal.candidates.unshift(control);
    const before = structuredClone({ context, proposal });
    const plan = planExperiments(proposal, context);
    expect(plan.selectedCandidateId).toBe("candidate-1");
    expect(plan.rankings[0]!.informationGainBits).toBe(1);
    expect(plan.rankings[1]!.informationGainBits).toBe(0);
    expect(plan.request).toMatchObject({ experimentId: "EXP-1", hypothesisIds: ["H1", "H2"], path: "vite.config.ts" });
    expect({ context, proposal }).toEqual(before);
  });

  it("penalizes uncertainty without claiming a calibrated causal probability", () => {
    const { proposal } = setup();
    const predictions = proposal.candidates[0]!.predictions as ExperimentCandidate["predictions"];
    expect(predictedInformationGain(predictions)).toBe(1);
    predictions.push({ ...predictions[0]!, hypothesisId: "H3", expectedOutcome: "UNKNOWN" });
    expect(predictedInformationGain(predictions)).toBeCloseTo(2 / 3);
    predictions[1]!.expectedOutcome = "UNKNOWN";
    expect(predictedInformationGain(predictions)).toBe(0);
  });

  it("excludes UNKNOWN predictions from the executed experiment's hypothesis scope", () => {
    const { context, proposal } = setup();
    context.evidence.board.hypotheses.push({ ...context.evidence.board.hypotheses[0]!, id: "H3" });
    proposal.candidates[0]!.predictions.push({ ...proposal.candidates[0]!.predictions[0]!, hypothesisId: "H3", expectedOutcome: "UNKNOWN" });
    const plan = planExperiments(proposal, context);
    expect(plan.request?.hypothesisIds).toEqual(["H1", "H2"]);
    expect(plan.rankings[0]!.informationGainBits).toBeCloseTo(2 / 3);
  });

  it("uses an upstream runner intervention as a deterministic tie-break", () => {
    const { context, proposal } = setup();
    context.testSetupPaths = ["vitest.setup.ts"];
    context.evidence.files = [...context.evidence.files, { path: "vitest.setup.ts", content: "autoCleanup(false);", truncated: false }];
    proposal.candidates.unshift({ ...structuredClone(proposal.candidates[0]!), id: "candidate-2", path: "vitest.setup.ts", find: "false", replace: "true" });
    expect(planExperiments(proposal, context).selectedCandidateId).toBe("candidate-1");
  });

  it.each(["missing prediction", "duplicate prediction", "unknown hypothesis", "unseen evidence", "not allowlisted", "truncated file", "missing find", "no change", "repeated intervention", "duplicate candidate", "duplicate intervention", "unsafe path"])(
    "stops without an executable request for %s", (invalid) => {
      const { context, proposal } = setup();
      const candidate = proposal.candidates[0]!;
      if (invalid === "missing prediction") candidate.predictions.pop();
      if (invalid === "duplicate prediction") candidate.predictions[1]!.hypothesisId = "H1";
      if (invalid === "unknown hypothesis") candidate.predictions[1]!.hypothesisId = "H5";
      if (invalid === "unseen evidence") candidate.predictions[0]!.evidenceRefs[0]!.source = "unseen";
      if (invalid === "not allowlisted") context.runnerConfigPaths = [];
      if (invalid === "truncated file") context.evidence.files.at(-1)!.truncated = true;
      if (invalid === "missing find") candidate.find = "nonexistent fragment";
      if (invalid === "no change") candidate.replace = candidate.find;
      if (invalid === "repeated intervention") {
        context.previousPlans = [planExperiments(proposal, context)];
        candidate.id = "candidate-99";
        candidate.question = "Renaming the question must not permit repeated execution.";
      }
      if (invalid === "duplicate candidate") proposal.candidates.push({ ...structuredClone(candidate), replace: "threads: true, isolate: true" });
      if (invalid === "duplicate intervention") proposal.candidates.push({ ...structuredClone(candidate), id: "candidate-2" });
      if (invalid === "unsafe path") {
        candidate.path = "../vite.config.ts";
        context.runnerConfigPaths = [candidate.path];
      }
      const plan = planExperiments(proposal, context);
      expect(plan.status).not.toBe("SELECTED");
      expect(plan.request).toBeNull();
      expect(plan.selectedCandidateId).toBeNull();
    },
  );

  it("rejects an experiment citation for a hypothesis outside its recorded scope", () => {
    const { context, proposal } = setup();
    context.evidence.experiments = [{
      experimentId: "EXP-9", evidenceSource: "EXP-9", hypothesisIds: ["H2", "H3"],
      question: "A previous experiment with a different scope.",
      intervention: { path: "vite.config.ts", role: "RUNNER_CONFIGURATION", find: "different", replace: "different again" },
      command: { command: "npm test", exitCode: 1, stdout: "failure", stderr: "", durationMs: 1 },
      outcome: "FAILURE_PERSISTS", repositoryRestored: true,
    }];
    Object.assign(proposal.candidates[0]!.predictions[0]!.evidenceRefs[0]!, { kind: "EXPERIMENT", source: "EXP-9" });
    const plan = planExperiments(proposal, context);
    expect(plan.request).toBeNull();
    expect(plan.rankings[0]!.rejectionReasons.join(" ")).toContain("out-of-scope");
  });

  it.each(["executions", "planning rounds"])("stops at the %s budget without accepting another request", (budget) => {
    const { context, proposal } = setup();
    if (budget === "executions") context.remainingExecutions = 0;
    else context.maxPlanningRounds = 0;
    expect(planExperiments(proposal, context)).toMatchObject({ status: "STOPPED", request: null, reason: expect.stringContaining("budget exhausted") });
  });

  it("accepts explicit early stopping and ignores advisory stop text when candidates exist", () => {
    const { context, proposal } = setup();
    const stopReason =
      "Existing observations suffice; no useful intervention remains.";

    expect(
      planExperiments({ candidates: [], stopReason }, context),
    ).toMatchObject({
      status: "STOPPED",
      reason: stopReason,
      request: null,
    });

    expect(
      planExperiments({ ...proposal, stopReason }, context),
    ).toMatchObject({
      status: "SELECTED",
      selectedCandidateId: "candidate-1",
      request: expect.objectContaining({ path: "vite.config.ts" }),
    });

    expect(
      planExperiments({ candidates: [], stopReason: null }, context).status,
    ).toBe("REJECTED");
  });

  it.each(["command", "informationGainBits", "recommendedPatchTargets"])("rejects model-owned %s at the planning boundary", (field) => {
    const { context, proposal } = setup();
    Object.assign(proposal.candidates[0]!, { [field]: "injected value" });
    expect(planExperiments(proposal, context).status).toBe("REJECTED");
  });
});
