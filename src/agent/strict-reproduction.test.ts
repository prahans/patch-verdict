import type { Sandbox } from "e2b";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  NormalizedRun,
  TestIdentity,
} from "../mission/third-party-types.js";
import {
  discoverExistingReproduction,
  discoverReproduction,
  generateRegressionReproduction,
  type ReproductionDiscoveryInput,
} from "./strict-reproduction.js";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  freeze: vi.fn(),
  untouched: vi.fn(),
  attempts: 0,
}));
vi.mock("../ai/openrouter.js", () => ({
  openRouter: { chat: { send: mocks.send } },
  AGENT_MODEL: "test-model",
}));
vi.mock("../tools/strict-git-evidence.js", () => ({
  assertUntouchedRepository: mocks.untouched,
}));
vi.mock("../tools/strict-policy.js", async (load) => {
  const actual = await load<typeof import("../tools/strict-policy.js")>();
  return {
    ...actual,
    createStrictRepositoryTools: () => mocks.read,
    createRegressionWriter: () => ({
      write: mocks.write,
      freeze: mocks.freeze,
      get attempts() {
        return mocks.attempts;
      },
    }),
  };
});

const sandbox = {} as Sandbox;
const target = {
  testPath: "src/calc.test.ts",
  testIdentity: "returns zero for zero denominator",
};
const generated = { ...target, testPath: "src/generated.test.ts" };
const source =
  "test('returns zero for zero denominator', () => expect(divide(4, 0)).toBe(0));";
const issue =
  "Division should return zero for zero denominator instead of Infinity.";
let files: Map<string, string>;
let input: ReproductionDiscoveryInput;

function run(identity: TestIdentity = target, pass = false): NormalizedRun {
  return {
    execution: "COMPLETED",
    ...(pass ? {} : { errorKind: "TARGET_TEST_FAILURE" as const }),
    discovered: [identity],
    passed: pass ? [identity] : [],
    failed: pass ? [] : [{ ...identity, message: "Expected Infinity to be 0" }],
    evidence: {
      command: "trusted-target",
      exitCode: pass ? 0 : 1,
      stdout: "",
      stderr: "",
      durationMs: 1,
    },
  };
}
function message(content: string | null, calls?: Array<[string, unknown]>) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
          ...(calls
            ? {
                toolCalls: calls.map(([name, args], i) => ({
                  id: `call-${i}`,
                  type: "function",
                  function: { name, arguments: JSON.stringify(args) },
                })),
              }
            : {}),
        },
      },
    ],
  };
}
function proposal(identity: TestIdentity = target) {
  return {
    ...identity,
    issueQuote: "return zero for zero denominator",
    assertionQuote: "expect(divide(4, 0)).toBe(0)",
    reason:
      "The observed test checks division by zero returns the exact value requested by the issue.",
  };
}
function write(identity = generated, content = source) {
  return { path: identity.testPath, content, ...proposal(identity) };
}

function noReproduction() {
  return {
    notReproducible: true,
    issueQuote: "return zero for zero denominator",
    sourcePath: "src/calc.ts",
    sourceQuote: "export const divide = (a,b) => a / b;",
    reason:
      "The inspected implementation already returns the issue-requested value for the quoted behavior.",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.attempts = 0;
  files = new Map([
    [target.testPath, source],
    ["src/calc.ts", "export const divide = (a,b) => a / b;"],
  ]);
  mocks.untouched.mockResolvedValue(undefined);
  mocks.read.mockImplementation(async (_sandbox, name, value) => {
    if (name === "read_file" && files.has(value.path))
      return {
        ok: true,
        data: { path: value.path, content: files.get(value.path) },
      };
    return { ok: false, error: "Unavailable read" };
  });
  mocks.write.mockImplementation(async (_sandbox, value) => {
    mocks.attempts++;
    files.set(value.path, value.content);
    return { ok: true, data: { path: value.path, sha256: "a".repeat(64) } };
  });
  input = {
    issue,
    projectRoot: "/repo",
    framework: "vitest",
    adapter: {
      command: () => "trusted-target",
      run: vi.fn().mockResolvedValue(run()),
    },
    baseline: run(),
    targetBranch: "release/2.x",
    baseCommit: "a".repeat(40),
  };
});

describe("read-only issue-specific discovery", () => {
  it("freezes only an observed, read, issue-grounded identity after two stable behavior failures", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: target.testPath }]]),
      )
      .mockResolvedValueOnce(message(JSON.stringify(proposal())));
    const result = await discoverExistingReproduction(sandbox, input);
    expect(result.frozen).toMatchObject({
      origin: "EXISTING_TEST",
      ...target,
      stable: true,
      targetBranch: "release/2.x",
      baseCommit: input.baseCommit,
      frozenSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      provenance: {
        issueQuote: proposal().issueQuote,
        assertionQuote: proposal().assertionQuote,
        reason: proposal().reason,
      },
    });
    expect(input.adapter.run).toHaveBeenCalledTimes(2);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("does not treat an arbitrary failing baseline as the selected issue", async () => {
    mocks.send.mockResolvedValueOnce(
      message(
        JSON.stringify(
          proposal({
            testPath: "other.test.ts",
            testIdentity: "unrelated failure",
          }),
        ),
      ),
    );
    expect(
      (await discoverExistingReproduction(sandbox, input)).frozen,
    ).toBeUndefined();
    expect(input.adapter.run).not.toHaveBeenCalled();
  });

  it("blocks model-invented write and shell tools at runtime", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [
          ["apply_patch", { path: "src/calc.ts" }],
          ["shell", { command: "evil" }],
        ]),
      )
      .mockResolvedValueOnce(message('{"none":true}'));
    await discoverExistingReproduction(sandbox, input);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    const history = mocks.send.mock.calls[1]![0].chatRequest.messages;
    expect(
      history
        .filter((item: { role: string }) => item.role === "tool")
        .every((item: { content: string }) =>
          item.content.includes("read-only"),
        ),
    ).toBe(true);
  });

  it("returns unstable without generating a replacement when a selected target flakes", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: target.testPath }]]),
      )
      .mockResolvedValueOnce(message(JSON.stringify(proposal())));
    vi.mocked(input.adapter.run)
      .mockResolvedValueOnce(run())
      .mockResolvedValueOnce(run(target, true));
    expect(await discoverReproduction(sandbox, input)).toMatchObject({
      unstable: true,
    });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses test mutation during reproduction", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: target.testPath }]]),
      )
      .mockResolvedValueOnce(message(JSON.stringify(proposal())));
    vi.mocked(input.adapter.run).mockImplementation(async () => {
      files.set(target.testPath, `${source}\n// changed`);
      return run();
    });
    expect(await discoverExistingReproduction(sandbox, input)).toMatchObject({
      unstable: true,
      reason: expect.stringMatching(/file changed/),
    });
  });
});

describe("separate regression agent", () => {
  it("requires grounded source evidence before a passing generated candidate can stop reproduction", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: "src/calc.ts" }]]),
      )
      .mockResolvedValueOnce(
        message(null, [["write_regression_test", write()]]),
      )
      .mockResolvedValueOnce(
        message(JSON.stringify(noReproduction())),
      );
    vi.mocked(input.adapter.run).mockResolvedValue(run(generated, true));

    const result = await generateRegressionReproduction(sandbox, input);

    expect(result.frozen).toBeUndefined();
    expect(result.reason).toMatch(/already satisfied/);
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.freeze).toHaveBeenCalledOnce();
  });

  it("does not treat a tool-less prose response as target-not-reproduced", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: "src/calc.ts" }]]),
      )
      .mockResolvedValueOnce(message("I think the issue may already be fixed."))
      .mockResolvedValueOnce(
        message(null, [["write_regression_test", write()]]),
      );

    vi.mocked(input.adapter.run).mockResolvedValue(run(generated));

    const result = await generateRegressionReproduction(sandbox, input);

    expect(result.frozen).toMatchObject({
      origin: "GENERATED_REGRESSION",
      ...generated,
    });
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledTimes(3);
    expect(mocks.send.mock.calls[0]![0].chatRequest.toolChoice).toBe(
      "required",
    );
    expect(mocks.send.mock.calls[2]![0].chatRequest.toolChoice).toBe(
      "required",
    );
    expect(
      mocks.send.mock.calls[2]![0].chatRequest.tools.map(
        (tool: { function: { name: string } }) => tool.function.name,
      ),
    ).toEqual(["write_regression_test"]);
  });

  it("permits one same-file revision when a passing candidate missed another explicit issue behavior", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: "src/calc.ts" }]]),
      )
      .mockResolvedValueOnce(
        message(null, [["write_regression_test", write()]]),
      )
      .mockResolvedValueOnce(
        message(null, [
          [
            "write_regression_test",
            write(generated, `${source}\n// second issue-grounded behavior`),
          ],
        ]),
      );

    vi.mocked(input.adapter.run)
      .mockResolvedValueOnce(run(generated, true))
      .mockResolvedValueOnce(run(generated))
      .mockResolvedValueOnce(run(generated));

    const result = await generateRegressionReproduction(sandbox, input);

    expect(result.frozen).toMatchObject({
      origin: "GENERATED_REGRESSION",
      ...generated,
    });
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.freeze).toHaveBeenCalledOnce();
  });
  it("corrects one invalid generated import on the same file before freezing", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: "src/calc.ts" }]]),
      )
      .mockResolvedValueOnce(
        message(null, [["write_regression_test", write()]]),
      )
      .mockResolvedValueOnce(
        message(null, [
          [
            "write_regression_test",
            write(generated, `${source}\n// corrected import`),
          ],
        ]),
      );
    vi.mocked(input.adapter.run)
      .mockResolvedValueOnce({
        ...run(generated),
        execution: "ERROR",
        errorKind: "MODULE_RESOLUTION_ERROR",
        discovered: [],
        failed: [],
      })
      .mockResolvedValue(run(generated));
    const result = await generateRegressionReproduction(sandbox, input);
    expect(result.frozen).toMatchObject({
      origin: "GENERATED_REGRESSION",
      ...generated,
      provenance: {
        issueQuote: proposal(generated).issueQuote,
        assertionQuote: proposal(generated).assertionQuote,
        reason: proposal(generated).reason,
      },
    });
    expect(result.generatedPath).toBe(generated.testPath);
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(mocks.freeze).toHaveBeenCalledOnce();
    expect(mocks.untouched).toHaveBeenCalledWith(
      sandbox,
      "/repo",
      input.baseCommit,
      generated.testPath,
    );
  });

  it("never accepts two compile/parse/import errors as target reproduction", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [["read_file", { path: "src/calc.ts" }]]),
      )
      .mockResolvedValueOnce(
        message(null, [["write_regression_test", write()]]),
      )
      .mockResolvedValueOnce(
        message(null, [["write_regression_test", write()]]),
      );
    vi.mocked(input.adapter.run).mockResolvedValue({
      ...run(generated),
      execution: "ERROR",
      errorKind: "TEST_COMPILE_ERROR",
      discovered: [],
      failed: [],
    });
    const result = await generateRegressionReproduction(sandbox, input);
    expect(result.frozen).toBeUndefined();
    expect(result.reason).toMatch(/two attempts/);
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });

  it("blocks production-edit tools and a third write queued after accepted reproduction", async () => {
    mocks.send
      .mockResolvedValueOnce(
        message(null, [
          ["read_file", { path: "src/calc.ts" }],
          ["apply_patch", { path: "src/calc.ts" }],
        ]),
      )
      .mockResolvedValueOnce(
        message(null, [
          ["write_regression_test", write()],
          [
            "write_regression_test",
            write({ ...generated, testPath: "src/evil.test.ts" }),
          ],
        ]),
      );
    vi.mocked(input.adapter.run).mockResolvedValue(run(generated));
    expect(
      (await generateRegressionReproduction(sandbox, input)).frozen,
    ).toBeDefined();
    expect(mocks.write).toHaveBeenCalledOnce();
    expect(files.get("src/calc.ts")).toBe(
      "export const divide = (a,b) => a / b;",
    );
    expect(files.has("src/evil.test.ts")).toBe(false);
  });
});
