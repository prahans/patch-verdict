import { describe, expect, it } from "vitest";

import type { CommandEvidence } from "../evidence/command-evidence.js";
import { runCounterfactualWithAccess } from "./run-counterfactual.js";

function commandEvidence(input: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): CommandEvidence {
  return {
    command: "npm test",
    exitCode: input.exitCode,
    stdout: input.stdout ?? "",
    stderr: input.stderr ?? "",
    durationMs: 10,
  };
}

function createHarness(input?: {
  original?: string;
  evidence?: CommandEvidence;
  dirtyBefore?: boolean;
  dirtyAfter?: boolean;
}) {
  let content =
    input?.original ??
    "export default { test: { threads: false } };";

  const original = content;

  return {
    get content() {
      return content;
    },

    access: {
      readFile: async () => content,

      writeFile: async (_path: string, next: string) => {
        content = next;
      },

      runTrustedCommand: async () =>
        input?.evidence ??
        commandEvidence({
          exitCode: 0,
          stdout: "5 passed",
        }),

      assertRepositoryClean: async (phase: "before" | "after") => {
        if (
          (phase === "before" && input?.dirtyBefore) ||
          (phase === "after" && input?.dirtyAfter)
        ) {
          throw new Error(`dirty ${phase}`);
        }
      },
    },

    original,
  };
}

const request = {
  experimentId: "EXP-1",
  hypothesisIds: ["H1", "H2"],
  question:
    "Does changing Vitest thread isolation remove the reproduced cleanup failure?",
  path: "vite.config.ts",
  find: "threads: false",
  replace: "threads: true",
};

const context = {
  trustedCommand: "npm test",
  baselineExitCode: 1,
  requiredOutput: ["Found multiple elements"],
  allowedPaths: ["vite.config.ts", "vitest.setup.ts"],
};

describe("runCounterfactualWithAccess", () => {
  it("temporarily changes one allowlisted causal variable and restores the file", async () => {
    const harness = createHarness();

    const result = await runCounterfactualWithAccess({
      request,
      context,
      access: harness.access,
    });

    expect(result.outcome).toBe("FAILURE_REMOVED");
    expect(result.repositoryRestored).toBe(true);
    expect(harness.content).toBe(harness.original);
  });

  it("classifies the failure as persisting when trusted baseline markers remain", async () => {
    const harness = createHarness({
      evidence: commandEvidence({
        exitCode: 1,
        stderr: "TestingLibraryElementError: Found multiple elements",
      }),
    });

    const result = await runCounterfactualWithAccess({
      request,
      context,
      access: harness.access,
    });

    expect(result.outcome).toBe("FAILURE_PERSISTS");
    expect(harness.content).toBe(harness.original);
  });

  it("classifies a different nonzero failure as inconclusive", async () => {
    const harness = createHarness({
      evidence: commandEvidence({
        exitCode: 1,
        stderr: "SyntaxError: unexpected token",
      }),
    });

    const result = await runCounterfactualWithAccess({
      request,
      context,
      access: harness.access,
    });

    expect(result.outcome).toBe("INCONCLUSIVE");
    expect(harness.content).toBe(harness.original);
  });

  it("rejects a path outside the reconnaissance experiment allowlist", async () => {
    const harness = createHarness();

    await expect(
      runCounterfactualWithAccess({
        request: {
          ...request,
          path: "src/components/DarkMode.test.tsx",
        },
        context,
        access: harness.access,
      }),
    ).rejects.toThrow(/not allowlisted/i);
  });

  it("requires the intervention text to match exactly once", async () => {
    const harness = createHarness({
      original:
        "threads: false\nconst copy = 'threads: false';",
    });

    await expect(
      runCounterfactualWithAccess({
        request,
        context,
        access: harness.access,
      }),
    ).rejects.toThrow(/match exactly once/i);

    expect(harness.content).toBe(harness.original);
  });

  it("refuses to experiment on an already dirty repository", async () => {
    const harness = createHarness({
      dirtyBefore: true,
    });

    await expect(
      runCounterfactualWithAccess({
        request,
        context,
        access: harness.access,
      }),
    ).rejects.toThrow(/dirty before/i);

    expect(harness.content).toBe(harness.original);
  });

  it("fails closed if exact restoration cannot be verified", async () => {
    let writeCount = 0;

    const harness = createHarness();

    await expect(
      runCounterfactualWithAccess({
        request,
        context,
        access: {
          ...harness.access,

          writeFile: async (_path, next) => {
            writeCount += 1;

            if (writeCount === 1) {
              await harness.access.writeFile(_path, next);
              return;
            }

            await harness.access.writeFile(
              _path,
              "restoration-corrupted",
            );
          },
        },
      }),
    ).rejects.toThrow(/restoration failed closed/i);
  });

  it("rejects a model-supplied duplicate hypothesis list", async () => {
    const harness = createHarness();

    await expect(
      runCounterfactualWithAccess({
        request: {
          ...request,
          hypothesisIds: ["H1", "H1"],
        },
        context,
        access: harness.access,
      }),
    ).rejects.toThrow(/must not contain duplicates/i);
  });
  it("rejects a model-supplied command field", async () => {
    const harness = createHarness();

    await expect(
      runCounterfactualWithAccess({
        request: {
          ...request,
          command: "echo model-controlled-command",
        },
        context,
        access: harness.access,
      }),
    ).rejects.toThrow();

    expect(harness.content).toBe(harness.original);
  });

  it("fails closed if the executed command is not the trusted reproduction command", async () => {
    const harness = createHarness({
      evidence: {
        command: "different command",
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationMs: 10,
      },
    });

    await expect(
      runCounterfactualWithAccess({
        request,
        context,
        access: harness.access,
      }),
    ).rejects.toThrow(/other than the trusted reproduction command/i);

    expect(harness.content).toBe(harness.original);
  });

});
