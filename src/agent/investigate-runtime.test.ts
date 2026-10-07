import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sandbox } from "e2b";
import { investigateIssue, InvestigationEvidenceError } from "./investigate.js";
import { causalFixture, deferredFreeze, modelResponse, toolResponse, experimentFixture } from "./test-fixtures/causal.js";

const { send, createBoard, executeTool, counterfactual } = vi.hoisted(() => ({
  send: vi.fn(), createBoard: vi.fn(), executeTool: vi.fn(), counterfactual: vi.fn(),
}));
vi.mock("../ai/openrouter.js", () => ({ AGENT_MODEL: "test", openRouter: { chat: { send } } }));
vi.mock("./create-hypothesis-board.js", () => ({ createInitialHypothesisBoard: createBoard }));
vi.mock("../tools/index.js", () => ({ executeTool }));
vi.mock("../tools/run-counterfactual.js", () => ({ runCounterfactualExperiment: counterfactual }));

function run(fixture = causalFixture()) {
  return investigateIssue({} as Sandbox, fixture.causalEvidence.issue,
    fixture.causalEvidence.baseline, fixture.reconnaissance, "/tmp/patchverdict");
}

describe("live causal investigation finalization", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    createBoard.mockResolvedValue(causalFixture().causalEvidence.board);
  });
  afterEach(() => vi.restoreAllMocks());

  it("discards early repair suggestions and independently freezes the recorded evidence", async () => {
    const fixture = causalFixture();
    send.mockResolvedValueOnce(modelResponse({ recommendedPatchTargets: ["invented.ts"], rootCause: "invented" }));
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.causalFreeze).toEqual(fixture.freeze);
    expect(result).not.toHaveProperty("diagnosis");
    expect(result.causalEvidence.files).toEqual(fixture.causalEvidence.files);
    expect(send).toHaveBeenCalledTimes(2);
    const gathering = send.mock.calls[0]![0].chatRequest;
    expect(gathering.messages[0].content).not.toContain('"recommendedPatchTargets"');
    const finalization = send.mock.calls[1]![0].chatRequest;
    expect(finalization).not.toHaveProperty("tools");
    expect(JSON.stringify(finalization.messages)).not.toContain("invented.ts");
  });

  it("runs the same causal finalizer after the iteration budget is exhausted", async () => {
    const fixture = causalFixture();
    for (let i = 0; i < 8; i++) send.mockResolvedValueOnce(toolResponse("search_code", { query: `different-${i}` }));
    executeTool.mockResolvedValue({ ok: true, data: { matches: [] } });
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.iterations).toBe(8);
    expect(result.causalFreeze).toEqual(fixture.freeze);
    expect(send).toHaveBeenCalledTimes(9);
    expect(send.mock.calls[8]![0].chatRequest).not.toHaveProperty("tools");
  });

  it("finalizes from recorded evidence when duplicate-call budget ends collection", async () => {
    const fixture = causalFixture();
    for (let i = 0; i < 3; i++) send.mockResolvedValueOnce(toolResponse("search_code", { query: "divide" }));
    executeTool.mockResolvedValue({ ok: true, data: { matches: [] } });
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.iterations).toBe(3);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.causalFreeze.status).toBe("FROZEN");
  });

  it("keeps a deferred decision without invoking a repair-planning response", async () => {
    const fixture = causalFixture();
    const deferred = deferredFreeze(fixture.freeze);
    send.mockResolvedValueOnce(modelResponse("done"));
    send.mockResolvedValueOnce(modelResponse(deferred));
    const result = await run(fixture);
    expect(result.causalFreeze).toEqual(deferred);
    expect(result.report).toContain("NEEDS_MORE_EVIDENCE");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("finalizes when the successful test-call budget is exhausted", async () => {
    const fixture = causalFixture();
    for (const testName of ["case one", "case two", "case three"]) {
      send.mockResolvedValueOnce(toolResponse("run_test", { testName }));
    }
    executeTool.mockResolvedValue({ ok: true, data: {
      command: "vitest -t case", exitCode: 1, stdout: "failure", stderr: "", durationMs: 1,
    } });
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.iterations).toBe(3);
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(result.causalEvidence.tests).toHaveLength(2);
    expect(result.causalFreeze.status).toBe("FROZEN");
  });

  it.each(["FAILURE_REMOVED", "FAILURE_PERSISTS", "INCONCLUSIVE"])("records and displays restored %s counterfactual evidence", async (outcome) => {
    const { fixture, proposal } = experimentFixture();
    const exitCode = outcome === "FAILURE_REMOVED" ? 0 : 1;
    const experiment = {
      experimentId: "EXP-1", evidenceSource: "EXP-1", hypothesisIds: ["H1", "H2"],
      question: "Does the failure persist under an alternate runner condition?",
      intervention: { path: "vite.config.ts", role: "RUNNER_CONFIGURATION", find: "threads: false", replace: "threads: true" },
      command: { command: "npm test", exitCode, stdout: outcome === "FAILURE_PERSISTS" ? "expected to throw" : "", stderr: "", durationMs: 2 },
      outcome, repositoryRestored: true,
    };
    send.mockResolvedValueOnce(toolResponse("plan_experiments", proposal));
    counterfactual.mockResolvedValueOnce(experiment);
    send.mockResolvedValueOnce(modelResponse("done"));
    fixture.freeze.hypothesisAssessments[0]!.evidenceRefs.push({ kind: "EXPERIMENT", source: "EXP-1" });
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.experiments).toEqual([experiment]);
    expect(result.causalEvidence.experiments).toEqual([experiment]);
    expect(result.causalFreeze).toEqual(fixture.freeze);
    expect(console.log).toHaveBeenCalledWith("← plan_experiments",
      `EXP-1: ${outcome} | RUNNER_CONFIGURATION | hypotheses H1, H2 | exit ${exitCode} | repository restored: true`);
    const plan = result.causalEvidence.experimentPlanning!.plans[0]!;
    expect(plan.selectedCandidateId).toBe("candidate-1");
    expect(plan.execution).toEqual({ status: "COMPLETED", evidenceSource: "EXP-1", error: null });
    expect(counterfactual.mock.calls[0]![1]).toEqual(plan.request);
  });

  it("records only successful file/test observations for the finalizer", async () => {
    const fixture = causalFixture();
    fixture.reconnaissance.inventory.push("src/helper.ts", "src/missing.ts");
    send.mockResolvedValueOnce(toolResponse("read_file", { path: "src/helper.ts" }));
    executeTool.mockResolvedValueOnce({ ok: true, data: { path: "src/helper.ts", content: "observed helper" } });
    send.mockResolvedValueOnce(toolResponse("read_file", { path: "src/missing.ts" }));
    executeTool.mockResolvedValueOnce({ ok: false, error: "missing" });
    send.mockResolvedValueOnce(toolResponse("run_test", { testName: "zero divisor" }));
    const evidence = { command: "vitest -t 'zero divisor'", exitCode: 1, stdout: "observed failure", stderr: "", durationMs: 3 };
    executeTool.mockResolvedValueOnce({ ok: true, data: evidence });
    send.mockResolvedValueOnce(modelResponse("done"));
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.causalEvidence.files).toContainEqual({ path: "src/helper.ts", content: "observed helper", truncated: false });
    expect(result.causalEvidence.files.some((file) => file.path === "src/missing.ts")).toBe(false);
    expect(result.causalEvidence.tests).toEqual([{ selector: "zero divisor", evidence }]);
  });

  it("rejects apply_patch even when the model calls an unexposed tool", async () => {
    const fixture = causalFixture();
    send.mockResolvedValueOnce(toolResponse("apply_patch", { path: "src/divide.ts", content: "bad" }));
    send.mockResolvedValueOnce(modelResponse("done"));
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    await run(fixture);
    expect(executeTool).not.toHaveBeenCalled();
  });

  it("aborts before causal finalization if an experiment cannot restore the repository", async () => {
    const { fixture, proposal } = experimentFixture();
    send.mockResolvedValueOnce(toolResponse("plan_experiments", proposal));
    counterfactual.mockRejectedValue(new Error("Counterfactual experiment restoration failed closed: dirty after"));
    const error = await run(fixture).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(InvestigationEvidenceError);
    expect((error as Error).message).toMatch(/restoration failed closed/);
    expect((error as InvestigationEvidenceError).evidence.experiments).toEqual([]);
    expect((error as InvestigationEvidenceError).evidence.experimentPlanning?.plans[0]?.execution?.status).toBe("FAILED");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not finalize without any successfully observed repository file", async () => {
    const fixture = causalFixture();
    fixture.reconnaissance.files = [];
    fixture.reconnaissance.preInspectedFiles = [];
    send.mockResolvedValueOnce(modelResponse("done"));
    await expect(run(fixture)).rejects.toThrow(/without successfully inspected files/);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("cannot bypass experiment ranking by calling the old direct tool", async () => {
    const fixture = causalFixture();
    send.mockResolvedValueOnce(toolResponse("run_counterfactual", { experimentId: "EXP-1", hypothesisIds: ["H1", "H2"] }));
    send.mockResolvedValueOnce(modelResponse("done"));
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(counterfactual).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    expect(result.experiments).toEqual([]);
  });

  it("stops immediately on zero information gain, including later calls in the same batch", async () => {
    const { fixture, proposal } = experimentFixture();
    proposal.candidates[0]!.predictions.forEach((item) => { item.expectedOutcome = "FAILURE_REMOVED"; });
    const response = toolResponse("plan_experiments", proposal);
    response.choices[0]!.message.toolCalls.push(toolResponse("run_test", { testName: "zero divisor" }).choices[0]!.message.toolCalls[0]!);
    send.mockResolvedValueOnce(response);
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.iterations).toBe(1);
    expect(result.causalEvidence.experimentPlanning?.stopReason).toBe("EXPERIMENT_PLANNER_STOP");
    expect(result.causalEvidence.experimentPlanning?.plans[0]?.request).toBeNull();
    expect(result.causalEvidence.experimentPlanning?.plans).toHaveLength(1);
    expect(counterfactual).not.toHaveBeenCalled();
    expect(executeTool).not.toHaveBeenCalled();
    // A deliberate zero-information-gain stop counts as an M4 attempt.
    // The host fallback must not invoke a second planner before Causal Freeze.
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("counts failed experiment attempts against the execution budget", async () => {
    const { fixture, proposal } = experimentFixture();
    for (let i = 0; i < 3; i++) {
      const next = structuredClone(proposal);
      next.candidates[0]!.replace += ` /* variant ${i} */`;
      send.mockResolvedValueOnce(toolResponse("plan_experiments", next));
    }
    counterfactual.mockRejectedValue(new Error("Trusted command unavailable; repository restored."));
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(counterfactual).toHaveBeenCalledTimes(2);
    expect(result.experiments).toEqual([]);
    expect(result.causalEvidence.experimentPlanning?.usage.experimentExecutions).toBe(2);
    const plans = result.causalEvidence.experimentPlanning!.plans;
    expect(plans.map((plan) => plan.request?.experimentId ?? null)).toEqual(["EXP-1", "EXP-2", null]);
    expect(plans[0]!.execution?.status).toBe("FAILED");
    expect(plans[2]!.reason).toContain("budget exhausted");
  });

  it("bounds repeated invalid planning proposals without executing any experiment", async () => {
    const fixture = causalFixture();
    for (let i = 0; i < 3; i++) send.mockResolvedValueOnce(toolResponse("plan_experiments", { invalid: i }));
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(result.iterations).toBe(3);
    expect(result.causalEvidence.experimentPlanning?.plans).toHaveLength(3);
    expect(counterfactual).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("enforces a total tool-call ceiling even inside one model response", async () => {
    const fixture = causalFixture();
    const response = toolResponse("search_code", { query: "unique-0" });
    for (let i = 1; i < 30; i++) response.choices[0]!.message.toolCalls.push(
      toolResponse("search_code", { query: `unique-${i}` }).choices[0]!.message.toolCalls[0]!,
    );
    send.mockResolvedValueOnce(response);
    executeTool.mockResolvedValue({ ok: true, data: { matches: [] } });
    send.mockResolvedValueOnce(modelResponse(fixture.freeze));
    const result = await run(fixture);
    expect(executeTool).toHaveBeenCalledTimes(24);
    expect(result.causalEvidence.experimentPlanning?.usage.toolCalls).toBe(24);
    expect(result.causalEvidence.experimentPlanning?.stopReason).toBe("TOOL_CALL_BUDGET");
    expect(result.iterations).toBe(1);
  });
});
