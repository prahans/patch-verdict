import type { CommandEvidence } from "../evidence/command-evidence.js";

// Temporary heuristic: explicit reproduction expectations must distinguish
// the expected bug from command/setup failures before this is final proof logic.
export function didReproduceBug(evidence: CommandEvidence): boolean {
  const output = `${evidence.stdout}\n${evidence.stderr}`;

  return evidence.exitCode !== 0 && !output.includes("Startup Error");
}
