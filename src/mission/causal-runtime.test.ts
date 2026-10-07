import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Sandbox } from "e2b";
import { runMission } from "./runner.js";
import { writeProofBundle } from "../proof/bundle.js";
import { causalFixture, deferredFreeze, modelResponse } from "../agent/test-fixtures/causal.js";

const { send, createBoard, recon, verify, patch, gitEvidence } = vi.hoisted(() => ({
  send: vi.fn(), createBoard: vi.fn(), recon: vi.fn(), verify: vi.fn(), patch: vi.fn(), gitEvidence: vi.fn(),
}));
vi.mock("../ai/openrouter.js", () => ({ AGENT_MODEL: "test", openRouter: { chat: { send } } }));
vi.mock("../agent/create-hypothesis-board.js", () => ({ createInitialHypothesisBoard: createBoard }));
vi.mock("../agent/reconnaissance.js", async (original) => ({
  ...await original<typeof import("../agent/reconnaissance.js")>(), createDeterministicReconnaissance: recon,
}));
vi.mock("../verification/run-command.js", () => ({ runVerificationCommand: verify }));
vi.mock("../agent/patch.js", () => ({ patchIssue: patch }));
vi.mock("../tools/git-evidence.js", () => ({ getGitEvidence: gitEvidence }));

const input = {
  issue: "Division by zero should throw.", projectRoot: "/tmp/patchverdict",
  verificationPlan: {
    reproduction: { label: "Reproduce", command: "npm test", expectation: { expectedExitCodes: [1], requiredOutput: ["expected to throw"] } },
    fullSuite: { label: "Full suite", command: "npm test" },
  },
};

describe("mission causal gate and proof preservation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fixture = causalFixture();
    createBoard.mockResolvedValue(fixture.causalEvidence.board);
    recon.mockResolvedValue(fixture.reconnaissance);
    verify.mockResolvedValueOnce({ command: "npm test", exitCode: 1, stdout: "expected to throw", stderr: "", durationMs: 1 });
    verify.mockResolvedValue({ command: "npm test", exitCode: 0, stdout: "passed", stderr: "", durationMs: 1 });
    patch.mockResolvedValue({ patchApplied: true, authorization: {
      intentId: "intent-1", authorizedPath: "src/divide.ts",
      objective: "Reject a zero divisor before performing division.", repairKind: "ROOT_CAUSE_FIX",
      evidenceRefs: [{ kind: "FILE", source: "src/divide.ts" }],
    } });
    gitEvidence.mockResolvedValue({ ok: true, data: {
      changed: true, baseCommit: "a".repeat(40), changedFiles: ["src/divide.ts"],
      diff: "diff --git a/src/divide.ts b/src/divide.ts\n--- a/src/divide.ts\n+++ b/src/divide.ts\n@@ -1 +1 @@\n-export const divide = (a, b) => a / b;\n+export const divide = (a, b) => { if (b === 0) throw new Error('zero'); return a / b; };\n",
    } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("freezes, plans, then patches and verifies in the live mission sequence", async () => {
    const { freeze, planOutput } = causalFixture();
    send.mockResolvedValueOnce(modelResponse("done collecting"));
    send.mockResolvedValueOnce(modelResponse(freeze));
    send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await runMission({} as Sandbox, input);
    expect(result.status).toBe("COMPLETED");
    expect(result.verdict).toBe("VERIFIED");
    expect(result.investigation?.causalFreeze).toEqual(freeze);
    expect(result.investigation?.diagnosis?.rootCause).toBe(freeze.causalClaim);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.invocationCallOrder[2]!).toBeLessThan(patch.mock.invocationCallOrder[0]!);
    expect(verify).toHaveBeenCalledTimes(3);
    const phases = result.events.map((event) => event.message);
    expect(phases.indexOf("Causal decision: FROZEN")).toBeLessThan(phases.indexOf("AI patch phase started"));
  });

  it("stops a deferred mission before planning, patching, or post-patch verification", async () => {
    const { freeze } = causalFixture();
    send.mockResolvedValueOnce(modelResponse("done collecting"));
    send.mockResolvedValueOnce(modelResponse(deferredFreeze(freeze)));
    const result = await runMission({} as Sandbox, input);
    expect(result.status).toBe("FAILED");
    expect(result.error).toMatch(/planning is blocked/);
    expect(result.investigation?.causalFreeze?.status).toBe("NEEDS_MORE_EVIDENCE");
    expect(result.investigation?.diagnosis).toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
    expect(patch).not.toHaveBeenCalled();
    expect(gitEvidence).not.toHaveBeenCalled();
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("preserves the freeze when the separate repair plan fails validation", async () => {
    const { freeze, planOutput } = causalFixture();
    send.mockResolvedValueOnce(modelResponse("done collecting"));
    send.mockResolvedValueOnce(modelResponse(freeze));
    planOutput.plan.evidence.push({ kind: "FILE", source: "unseen.ts", observation: "invented" });
    send.mockResolvedValue(modelResponse(planOutput));
    const result = await runMission({} as Sandbox, input);
    expect(result.status).toBe("FAILED");
    expect(result.investigation?.causalFreeze).toEqual(freeze);
    expect(result.error).toMatch(/Repair plan failed/);
    expect(patch).not.toHaveBeenCalled();
  });

  it.each(["FROZEN", "NEEDS_MORE_EVIDENCE"])("persists %s and its actual evidence in proof.json", async (status) => {
    const { freeze, planOutput } = causalFixture();
    const decision = status === "FROZEN" ? freeze : deferredFreeze(freeze);
    send.mockResolvedValueOnce(modelResponse("done collecting"));
    send.mockResolvedValueOnce(modelResponse(decision));
    if (status === "FROZEN") send.mockResolvedValueOnce(modelResponse(planOutput));
    const result = await runMission({} as Sandbox, input);
    const directory = await mkdtemp(path.join(tmpdir(), "patchverdict-proof-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(directory);
    try {
      const bundle = await writeProofBundle({ missionId: "causal-test", input, result });
      const proof = JSON.parse(await readFile(path.join(bundle.outputDirectory, "proof.json"), "utf8"));
      expect(proof.investigation.causalFreeze).toEqual(decision);
      expect(proof.investigation.hypothesisBoard).toEqual(causalFixture().causalEvidence.board);
      expect(proof.investigation.causalEvidence.files).toEqual(causalFixture().causalEvidence.files);
      expect(proof.investigation.causalEvidence.baseline.outputExcerpt).toBe("expected to throw");
      if (status === "NEEDS_MORE_EVIDENCE") {
        expect(proof.investigation.diagnosis).toBeNull();
        expect(proof.patch).toBeNull();
        expect(proof.error).toMatch(/planning is blocked/);
      }
    } finally {
      cwd.mockRestore();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
