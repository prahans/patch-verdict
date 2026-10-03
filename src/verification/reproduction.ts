import type { CommandEvidence } from "../evidence/command-evidence.js";

export function didReproduceBug(
  evidence: CommandEvidence,
  reproductionTestName: string,
): boolean {
  const output = `${evidence.stdout}\n${evidence.stderr}`;

  return (
    evidence.exitCode !== 0 &&
    output.includes(reproductionTestName) &&
    !output.includes("Startup Error")
  );
}
