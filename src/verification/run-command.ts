import type { Sandbox } from "e2b";

import type { CommandEvidence } from "../evidence/command-evidence.js";

import { runSandboxCommand } from "../sandbox/e2b.js";

import type { VerificationCommand } from "./types.js";

export async function runVerificationCommand(
  sandbox: Sandbox,
  projectRoot: string,
  verification: VerificationCommand,
): Promise<CommandEvidence> {
  return runSandboxCommand(sandbox, verification.command, projectRoot);
}
