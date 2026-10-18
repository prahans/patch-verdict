import type { Sandbox } from "e2b";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { patchIssue } from "./patch.js";
import { investigateIssue } from "./investigate.js";
import type { StrictRepairPolicy } from "../tools/strict-policy.js";

const mocks = vi.hoisted(() => ({ send: vi.fn(), execute: vi.fn() }));
vi.mock("../ai/openrouter.js", () => ({ openRouter: { chat: { send: mocks.send } }, AGENT_MODEL: "test-model" }));
vi.mock("../tools/index.js", () => ({ executeTool: mocks.execute }));
const sandbox = {} as Sandbox;
const diagnosis = {
  rootCause: "The implementation returns false instead of true.",
  evidence: [{ kind: "FILE" as const, source: "src/repair.ts", observation: "The function returns false." }],
  relevantFiles: ["src/repair.ts"], recommendedPatchTargets: ["src/repair.ts"],
  patchTargetAnalysis: [{ path: "src/repair.ts", decision: "RECOMMEND" as const, reason: "This file owns the incorrect return value." }], confidence: "HIGH" as const,
};
const context = { report: "The function returns the wrong boolean.", diagnosis };
const baseline = { command: "trusted-jest-command", exitCode: 1, reproduced: true as const, requiredOutput: [], outputExcerpt: "Expected true, received false" };
const call = (name: string, args: unknown, id = "call") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const response = (content: string | null, toolCalls?: ReturnType<typeof call>[]) => ({ choices: [{ message: { role: "assistant", content, ...(toolCalls ? { toolCalls } : {}) } }] });
const policy = (execute = vi.fn()) => ({ execute, allowedProductionFiles: ["src/repair.ts"], changedFiles: [], rejectedScope: false }) satisfies StrictRepairPolicy;
beforeEach(() => { vi.clearAllMocks(); });

describe("repair and investigation runtime boundaries", () => {
  it("stops before a second write queued in the same model response", async () => {
    const strict = policy(vi.fn().mockResolvedValue({ ok: true, data: { changed: true } }));
    mocks.send.mockResolvedValue(response(null, [call("apply_patch", { path: "src/repair.ts" }, "one"), call("apply_patch", { path: "src/other.ts" }, "two")]));
    expect(await patchIssue(sandbox, "Return true", context, undefined, strict)).toMatchObject({ patchApplied: true });
    expect(strict.execute).toHaveBeenCalledOnce();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("limits large malicious tool arrays to twenty dispatches", async () => {
    const strict = policy(vi.fn().mockResolvedValue({ ok: false, error: "blocked" }));
    mocks.send.mockResolvedValue(response(null, Array.from({ length: 100 }, (_, i) => call("read_file", { path: "src/repair.ts" }, String(i)))));
    expect(await patchIssue(sandbox, "Return true", context, undefined, strict)).toMatchObject({ completed: false, patchApplied: false, report: expect.stringMatching(/budget/) });
    expect(strict.execute).toHaveBeenCalledTimes(20);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it("reports strict scope refusal without inventing a candidate", async () => {
    mocks.send.mockResolvedValue(response("UNSUPPORTED_REPAIR_SCOPE: this requires changes to two production files."));
    expect(await patchIssue(sandbox, "Return true", context, undefined, policy())).toMatchObject({ patchApplied: false, unsupportedScope: true });
  });

  it("blocks forged investigator write tools and uses a supplied trusted framework executor", async () => {
    const execute = vi.fn().mockImplementation(async (_sandbox, name) => name === "run_test"
      ? { ok: true, data: { command: "trusted-jest-command", exitCode: 1, stdout: "Expected true", stderr: "" } }
      : { ok: true, data: { path: "src/repair.ts", content: "return false;" } });
    mocks.send.mockResolvedValueOnce(response(null, [call("apply_patch", { path: "src/repair.ts" }, "write"), call("read_file", { path: "src/repair.ts" }, "read"), call("run_test", { testName: "returns true" }, "test")]))
      .mockResolvedValueOnce(response(JSON.stringify(context)));
    expect(await investigateIssue(sandbox, "Return true", baseline, { execute })).toMatchObject({ completed: true, inspectedFiles: ["src/repair.ts"] });
    expect(execute.mock.calls.map((args) => args[1])).toEqual(["read_file", "run_test"]);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.send.mock.calls[0]![0].chatRequest.tools.find((tool: { function: { name: string } }) => tool.function.name === "run_test").function.description).toMatch(/trusted framework adapter/);
  });
});
