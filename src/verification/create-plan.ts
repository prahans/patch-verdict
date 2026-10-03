import type { PreparedRepository } from "../repository/types.js";

import type { ReproductionExpectation, VerificationPlan } from "./types.js";

type CreateVerificationPlanInput = {
  preparedRepository: PreparedRepository;

  reproductionCommand: string;

  reproductionExpectation: ReproductionExpectation;
};

export function createVerificationPlan({
  preparedRepository,
  reproductionCommand,
  reproductionExpectation,
}: CreateVerificationPlanInput): VerificationPlan {
  if (!reproductionCommand.trim()) {
    throw new Error("Reproduction command cannot be empty.");
  }

  if (reproductionExpectation.expectedExitCodes.length === 0) {
    throw new Error(
      "Reproduction expectation must define at least one expected exit code.",
    );
  }

  return {
    reproduction: {
      label: "Reported bug reproduction",

      command: reproductionCommand.trim(),

      expectation: reproductionExpectation,
    },

    fullSuite: {
      label: "Repository full test suite",

      command: preparedRepository.project.fullSuiteCommand,
    },
  };
}
