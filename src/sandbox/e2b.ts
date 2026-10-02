import { Sandbox } from "e2b";
import type { CommandEvidence } from "../evidence/command-evidence.js";

export async function createSandbox() {
  const sandbox = await Sandbox.create({
    timeoutMs: 10 * 60 * 1000,
  });

  return sandbox;
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
): Promise<CommandEvidence> {
  const startedAt = Date.now();

  try {
    const result = await sandbox.commands.run(command, {
      cwd,
      timeoutMs: 2 * 60 * 1000,
    });

    return {
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
  await sandbox.kill();
}
