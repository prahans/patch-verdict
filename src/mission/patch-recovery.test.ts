import type { Sandbox } from "e2b";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { patchIssue } from "../agent/patch.js";
import type { PatchInvestigationContext } from "../agent/patch-context.js";
import { runMission } from "./runner.js";
import type { MissionInput } from "./types.js";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  executeTool: vi.fn(),
  investigateIssue: vi.fn(),
  getGitEvidence: vi.fn(),
  runVerificationCommand: vi.fn(),
}));

vi.mock("../ai/openrouter.js", () => ({
  openRouter: { chat: { send: mocks.send } },
  AGENT_MODEL: "test-model",
}));
vi.mock("../tools/index.js", () => ({ executeTool: mocks.executeTool }));
vi.mock("../agent/investigate.js", () => ({ investigateIssue: mocks.investigateIssue }));
vi.mock("../tools/git-evidence.js", () => ({ getGitEvidence: mocks.getGitEvidence }));
vi.mock("../verification/run-command.js", () => ({
  runVerificationCommand: mocks.runVerificationCommand,
}));

const sandbox = {} as Sandbox;
const investigation: PatchInvestigationContext = {
  report: "The repair function returns the wrong value.",
  diagnosis: {
    rootCause: "The repair function returns false instead of true.",
    evidence: [{ kind: "FILE", source: "src/repair.ts", observation: "Returns false." }],
    relevantFiles: ["src/repair.ts"],
    recommendedPatchTargets: ["src/repair.ts"],
    patchTargetAnalysis: [{ path: "src/repair.ts", decision: "RECOMMEND", reason: "Owns the behavior." }],
    confidence: "HIGH",
  },
};
const input: MissionInput = {
  issue: "Repair should return true.",
  projectRoot: "/project",
  verificationPlan: {
    reproduction: { command: "check-repair", label: "Reproduction", expectation: { expectedExitCodes: [1] } },
    fullSuite: { command: "check-all", label: "Full suite" },
  },
};
const initialDiff = "diff --git a/src/repair.ts b/src/repair.ts\n-return false;\n+return Boolean(0);";
const correctedDiff = "diff --git a/src/repair.ts b/src/repair.ts\n-return false;\n+return true;";

function patchToolResult(changed: boolean) {
  return { ok: true, data: { path: "src/repair.ts", changed, before: "false", after: changed ? "true" : "false" } };
}

function gitEvidence(diff: string, changedFiles = ["src/repair.ts"]) {
  return { ok: true, data: { baseCommit: "base", changed: true, changedFiles, diff } };
}

function verificationResults(...exitCodes: number[]) {
  for (const [index, exitCode] of exitCodes.entries()) {
    const isFullSuite = index === exitCodes.length - 1;
    mocks.runVerificationCommand.mockResolvedValueOnce({
      command: isFullSuite ? "check-all" : "check-repair",
      exitCode,
      stdout: `output ${index}`,
      stderr: exitCode === 0 ? "" : `failure ${index}`,
      durationMs: 1,
    });
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  mocks.send.mockResolvedValue({
    choices: [{ message: { role: "assistant", content: null, toolCalls: [
      { id: "patch-call", type: "function", function: { name: "apply_patch", arguments: '{"path":"src/repair.ts","content":"return true;"}' } },
    ] } }],
  });
  mocks.executeTool.mockResolvedValue(patchToolResult(true));
  mocks.investigateIssue.mockResolvedValue({ completed: true, iterations: 1, ...investigation });
  mocks.getGitEvidence
    .mockResolvedValueOnce(gitEvidence(initialDiff))
    .mockResolvedValueOnce(gitEvidence(correctedDiff));
});

afterEach(() => vi.restoreAllMocks());

describe("no-op candidate handling", () => {
  it("exhausts the existing budget without accepting unchanged content", async () => {
    mocks.executeTool.mockResolvedValue(patchToolResult(false));

    const result = await patchIssue(sandbox, input.issue, investigation);

    expect(result).toMatchObject({ completed: false, patchApplied: false });
    expect(mocks.send).toHaveBeenCalledTimes(4);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("apply_patch NO CHANGE"));
  });

  it("returns the no-op tool result and behavioral guidance before accepting a change", async () => {
    const noChange = patchToolResult(false);
    mocks.executeTool.mockResolvedValueOnce(noChange);

    const result = await patchIssue(sandbox, input.issue, investigation);

    expect(result.patchApplied).toBe(true);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.send.mock.calls[1]?.[0].chatRequest.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", toolCallId: "patch-call", content: JSON.stringify(noChange) }),
      expect.objectContaining({ role: "user", content: expect.stringMatching(/smallest real behavioral change/i) }),
    ]));
  });
});

describe("one verification-guided correction", () => {
  it.each([0, 1])("does not retry a passing reproduction even when full-suite exit is %i", async (suiteExit) => {
    verificationResults(1, 0, suiteExit);

    const result = await runMission(sandbox, input);

    expect(result.verdict).toBe(suiteExit === 0 ? "VERIFIED" : "FAILED");
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.getGitEvidence).toHaveBeenCalledTimes(1);
    expect(mocks.runVerificationCommand.mock.calls.map((call) => call[2])).toEqual([
      input.verificationPlan.reproduction,
      input.verificationPlan.reproduction,
      input.verificationPlan.fullSuite,
    ]);
  });

  it.each([0, 1])("corrects once, then uses deterministic reproduction exit %i for the verdict", async (correctedExit) => {
    verificationResults(1, 1, correctedExit, 0);

    const result = await runMission(sandbox, input);

    expect(result.verdict).toBe(correctedExit === 0 ? "VERIFIED" : "FAILED");
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.investigateIssue).toHaveBeenCalledTimes(1);
    expect(mocks.getGitEvidence).toHaveBeenCalledTimes(2);
    expect(result.patch?.diff).toBe(correctedDiff);
    expect(result.evidence?.postPatchTest?.exitCode).toBe(correctedExit);
    expect(mocks.runVerificationCommand.mock.calls.map((call) => call[2])).toEqual([
      input.verificationPlan.reproduction,
      input.verificationPlan.reproduction,
      input.verificationPlan.reproduction,
      input.verificationPlan.fullSuite,
    ]);
    const correctionMessages = JSON.stringify(mocks.send.mock.calls[1]?.[0].chatRequest.messages);
    for (const expected of ["check-repair", "output 1", "failure 1", "Boolean(0)", investigation.diagnosis.rootCause]) {
      expect(correctionMessages).toContain(expected);
    }
    expect(correctionMessages).toContain('\\"exitCode\\": 1');
    expect(mocks.getGitEvidence.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.executeTool.mock.invocationCallOrder[1]!);
    expect(mocks.getGitEvidence.mock.invocationCallOrder[1]).toBeLessThan(mocks.runVerificationCommand.mock.invocationCallOrder[2]!);
  });

  it("fails closed when the correction only submits unchanged content", async () => {
    mocks.executeTool.mockReset()
      .mockResolvedValueOnce(patchToolResult(true))
      .mockResolvedValue(patchToolResult(false));
    mocks.getGitEvidence.mockReset().mockResolvedValue(gitEvidence(initialDiff));
    verificationResults(1, 1, 0, 0);

    const result = await runMission(sandbox, input);

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("real correction patch");
    expect(mocks.send).toHaveBeenCalledTimes(5);
    expect(mocks.investigateIssue).toHaveBeenCalledTimes(1);
    expect(mocks.getGitEvidence).toHaveBeenCalledTimes(2);
    expect(result.patch?.diff).toBe(initialDiff);
    expect(mocks.runVerificationCommand).toHaveBeenCalledTimes(2);
  });

  it("replaces stale candidate evidence when the correction restores unchanged Git content", async () => {
    mocks.getGitEvidence.mockReset()
      .mockResolvedValueOnce(gitEvidence(initialDiff))
      .mockResolvedValueOnce({ ok: true, data: { baseCommit: "base", changed: false, changedFiles: [], diff: "" } });
    verificationResults(1, 1, 0, 0);

    const result = await runMission(sandbox, input);

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("Git detected no repository changes");
    expect(result.patch).toEqual({ applied: false, baseCommit: "base", changedFiles: [], diff: "" });
    expect(result.verificationIntegrity?.status).toBe("PRESERVED");
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.runVerificationCommand).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["+expect(repair()).toBe(true);", "REVIEW_REQUIRED", "REVIEW_REQUIRED"],
    ["+test.skip('repair', () => {});", "COMPROMISED", "FAILED"],
  ])("reevaluates the cumulative correction diff containing %s", async (addedLine, integrity, verdict) => {
    const cumulativeDiff = `${correctedDiff}\ndiff --git a/src/repair.test.ts b/src/repair.test.ts\n${addedLine}`;
    mocks.getGitEvidence.mockReset()
      .mockResolvedValueOnce(gitEvidence(initialDiff))
      .mockResolvedValueOnce(gitEvidence(cumulativeDiff, ["src/repair.ts", "src/repair.test.ts"]));
    verificationResults(1, 1, 0, 0);

    const result = await runMission(sandbox, input);

    expect(result.verdict).toBe(verdict);
    expect(result.verificationIntegrity?.status).toBe(integrity);
    expect(result.checks?.verificationIntegrityPreserved).toBe(false);
    expect(result.patch?.diff).toBe(cumulativeDiff);
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.runVerificationCommand).toHaveBeenCalledTimes(4);
  });
});
