import { Sandbox } from "e2b";
import type { CommandEvidence } from "../evidence/command-evidence.js";

const sandboxRuntimeBins = new WeakMap<Sandbox, string>();

export type SandboxCommandOptions = {
  timeoutMs?: number;
  useRuntime?: boolean;
};

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Register a PatchVerdict-owned runtime bin directory for this sandbox.
 *
 * Every later runSandboxCommand call uses this directory first in PATH unless
 * explicitly bypassed by trusted bootstrap code. The path never comes from a
 * repository, issue, or browser input.
 */
export function registerSandboxRuntimeBin(
  sandbox: Sandbox,
  binPath: string,
): void {
  if (!/^\/tmp\/patchverdict-node-v\d+\.\d+\.\d+\/bin$/.test(binPath)) {
    throw new Error("Refusing to register an untrusted sandbox runtime path.");
  }

  sandboxRuntimeBins.set(sandbox, binPath);
}

function executionCommand(
  sandbox: Sandbox,
  command: string,
  useRuntime: boolean,
) {
  const runtimeBin = useRuntime ? sandboxRuntimeBins.get(sandbox) : undefined;

  if (!runtimeBin) {
    return command;
  }

  return `export PATH=${shellQuote(runtimeBin)}:"$PATH"; ${command}`;
}

export async function createSandbox() {
  const sandbox = await Sandbox.create({
    timeoutMs: 20 * 60 * 1000,
  });

  return sandbox;
}

export async function readSandboxFile(sandbox: Sandbox, path: string) {
  return sandbox.files.read(path);
}

export async function writeSandboxFile(
  sandbox: Sandbox,
  path: string,
  content: string,
) {
  await sandbox.files.write(path, content);
}

export async function runSandboxCommand(
  sandbox: Sandbox,
  command: string,
  cwd: string,
  options: SandboxCommandOptions = {},
): Promise<CommandEvidence> {
  const startedAt = Date.now();
  const actualCommand = executionCommand(
    sandbox,
    command,
    options.useRuntime !== false,
  );

  try {
    const result = await sandbox.commands.run(actualCommand, {
      cwd,
      timeoutMs: options.timeoutMs ?? 2 * 60 * 1000,
    });

    return {
      // Preserve the semantic command as evidence. The PatchVerdict-owned PATH
      // prefix is runtime plumbing, not repository verification input.
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    /*
     * E2B throws when a command exits with a non-zero code.
     *
     * That's important for PatchVerdict:
     * npm test failing is evidence, not necessarily an unexpected crash.
     */
    const commandError = error as {
      exitCode?: number;
      stdout?: string;
      stderr?: string;
    };

    if (typeof commandError.exitCode === "number") {
      return {
        command,
        exitCode: commandError.exitCode,
        stdout: commandError.stdout ?? "",
        stderr: commandError.stderr ?? "",
        durationMs: Date.now() - startedAt,
      };
    }

    throw error;
  }
}

export async function destroySandbox(sandbox: Sandbox) {
  sandboxRuntimeBins.delete(sandbox);
  await sandbox.kill();
}
