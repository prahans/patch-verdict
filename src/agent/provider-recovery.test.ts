import type { Sandbox } from "e2b";
import type { SendChatCompletionRequestRequest } from "@openrouter/sdk/models/operations";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { investigateIssue } from "./investigate.js";
import { patchIssue } from "./patch.js";
import type { PatchInvestigationContext } from "./patch-context.js";

const mocks = vi.hoisted(() => ({ send: vi.fn(), executeTool: vi.fn() }));

vi.mock("../ai/openrouter.js", async () => {
  const { createReliableChat } = await import("../ai/chat-recovery.js");
  return {
    openRouter: {
      chat: createReliableChat({ send: mocks.send }, {
        getDeadline: () => Date.now() + 270_000,
      }),
    },
    AGENT_MODEL: "test-model",
  };
});
vi.mock("../tools/index.js", () => ({ executeTool: mocks.executeTool }));

const sandbox = {} as Sandbox;
const issue = "Repair should return true.";
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
const readResult = { ok: true, data: { path: "src/repair.ts", content: "return false;" } };
const patchResult = { ok: true, data: { path: "src/repair.ts", changed: true, before: "return false;", after: "return true;" } };

function toolResponse(name: string, id: string, input: object) {
  return {
    choices: [{ message: {
      role: "assistant", content: null,
      toolCalls: [{ id, type: "function", function: { name, arguments: JSON.stringify(input) } }],
    } }],
  };
}
const readResponse = toolResponse("read_file", "read-call", { path: "src/repair.ts" });
const patchResponse = toolResponse("apply_patch", "patch-call", {
  path: "src/repair.ts", oldText: "return false;", newText: "return true;",
});
let requests: SendChatCompletionRequestRequest[];

async function runWithClock<T>(pending: Promise<T>): Promise<T> {
  const outcome = pending.then((value) => ({ value }), (error: unknown) => ({ error }));
  await vi.runAllTimersAsync();
  const result = await outcome;
  if ("error" in result) throw result.error;
  return result.value;
}

function assertRetainedReadContext(request: SendChatCompletionRequestRequest) {
  expect(request.chatRequest.messages).toHaveLength(4);
  expect(request.chatRequest.messages.slice(2)).toEqual([
    readResponse.choices[0]!.message,
    { role: "tool", toolCallId: "read-call", content: JSON.stringify(readResult) },
  ]);
  expect(request.chatRequest.provider).toMatchObject({
    allowFallbacks: true, requireParameters: true,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  requests = [];
  mocks.executeTool.mockImplementation(async (_sandbox, name) => (
    name === "read_file" ? readResult : patchResult
  ));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("provider recovery inside agent turns", () => {
  it("retries only the failed patch request while retaining tool context and applying the patch once", async () => {
    mocks.send.mockImplementation(async (request) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) return readResponse;
      if (requests.length === 2) throw { statusCode: 429, headers: new Headers() };
      return patchResponse;
    });

    const result = await runWithClock(patchIssue(sandbox, issue, investigation));

    expect(result).toEqual({ completed: true, patchApplied: true, report: "Candidate patch applied." });
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(mocks.executeTool.mock.calls.map((call) => call[1])).toEqual(["read_file", "apply_patch"]);
    assertRetainedReadContext(requests[1]!);
    expect(requests[2]).toEqual(requests[1]);
    for (const call of mocks.send.mock.calls) {
      expect(call[1]).toMatchObject({ retries: { strategy: "none" } });
    }
  });

  it("stops after exhausted retries without repeating reads or applying a patch", async () => {
    mocks.send.mockImplementation(async (request) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) return readResponse;
      throw { statusCode: 429, headers: new Headers() };
    });

    await expect(runWithClock(patchIssue(sandbox, issue, investigation))).rejects.toMatchObject({
      category: "RATE_LIMIT", reason: "RETRIES_EXHAUSTED", attempts: 4, statusCode: 429,
    });

    expect(mocks.send).toHaveBeenCalledTimes(5);
    expect(mocks.executeTool).toHaveBeenCalledExactlyOnceWith(sandbox, "read_file", { path: "src/repair.ts" });
    assertRetainedReadContext(requests[1]!);
    for (const retry of requests.slice(2)) expect(retry).toEqual(requests[1]);
  });

  it("continues the real investigation after a transient failure without repeating repository tools", async () => {
    mocks.send.mockImplementation(async (request) => {
      requests.push(structuredClone(request));
      if (requests.length === 1) return readResponse;
      if (requests.length === 2) throw { statusCode: 503, headers: new Headers() };
      return { choices: [{ message: { role: "assistant", content: JSON.stringify(investigation) } }] };
    });

    const baseline = {
      command: "check-repair", exitCode: 1, reproduced: true as const,
      requiredOutput: [], outputExcerpt: "Expected true; received false.",
    };
    const result = await runWithClock(investigateIssue(sandbox, issue, baseline));

    expect(result).toMatchObject({ completed: true, iterations: 2, ...investigation, inspectedFiles: ["src/repair.ts"] });
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(mocks.executeTool).toHaveBeenCalledExactlyOnceWith(sandbox, "read_file", { path: "src/repair.ts" });
    assertRetainedReadContext(requests[1]!);
    expect(JSON.stringify(requests[1]!.chatRequest.messages)).toContain(baseline.outputExcerpt);
    expect(requests[2]).toEqual(requests[1]);
  });
});
