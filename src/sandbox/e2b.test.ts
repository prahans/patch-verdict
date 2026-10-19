import type { Sandbox } from "e2b";
import { describe, expect, it, vi } from "vitest";

import {
  registerSandboxRuntimeBin,
  runSandboxCommand,
} from "./e2b.js";

function fakeSandbox() {
  const run = vi.fn(async () => ({
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  }));

  return {
    sandbox: {
      commands: { run },
      kill: vi.fn(async () => undefined),
    } as unknown as Sandbox,
    run,
  };
}

describe("sandbox runtime command routing", () => {
  it("uses the registered PatchVerdict runtime for later commands without changing evidence", async () => {
    const { sandbox, run } = fakeSandbox();

    registerSandboxRuntimeBin(
      sandbox,
      "/tmp/patchverdict-node-v22.14.0/bin",
    );

    const evidence = await runSandboxCommand(
      sandbox,
      "node --version",
      "/tmp/patchverdict",
    );

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe(
      "export PATH='/tmp/patchverdict-node-v22.14.0/bin':\"$PATH\"; node --version",
    );
    expect(evidence.command).toBe("node --version");
  });

  it("allows trusted bootstrap commands to bypass the registered runtime", async () => {
    const { sandbox, run } = fakeSandbox();

    registerSandboxRuntimeBin(
      sandbox,
      "/tmp/patchverdict-node-v22.14.0/bin",
    );

    await runSandboxCommand(sandbox, "uname -m", "/tmp", {
      useRuntime: false,
    });

    expect(run.mock.calls[0]?.[0]).toBe("uname -m");
  });

  it("rejects runtime paths that are not PatchVerdict-owned", () => {
    const { sandbox } = fakeSandbox();

    expect(() =>
      registerSandboxRuntimeBin(sandbox, "/tmp/repository/node_modules/.bin"),
    ).toThrow("untrusted sandbox runtime path");
  });
});
