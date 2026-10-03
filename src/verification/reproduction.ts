import type { CommandEvidence } from "../evidence/command-evidence.js";

import type { ReproductionExpectation } from "./types.js";

export type ReproductionClassification = {
  reproduced: boolean;

  checks: {
    exitCodeMatched: boolean;

    missingRequiredOutput: string[];

    presentForbiddenOutput: string[];
  };
};

export function classifyReproduction(
  evidence: CommandEvidence,
  expectation: ReproductionExpectation,
): ReproductionClassification {
  const output = `${evidence.stdout}\n${evidence.stderr}`;

  const exitCodeMatched = expectation.expectedExitCodes.includes(
    evidence.exitCode,
  );

  const missingRequiredOutput = (expectation.requiredOutput ?? []).filter(
    (required) => !output.includes(required),
  );

  const presentForbiddenOutput = (expectation.forbiddenOutput ?? []).filter(
    (forbidden) => output.includes(forbidden),
  );

  const reproduced =
    exitCodeMatched &&
    missingRequiredOutput.length === 0 &&
    presentForbiddenOutput.length === 0;

  return {
    reproduced,

    checks: {
      exitCodeMatched,

      missingRequiredOutput,

      presentForbiddenOutput,
    },
  };
}
