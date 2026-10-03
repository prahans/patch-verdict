import type { PreparedRepository } from "../repository/types.js";

import type { VerificationPlan } from "./types.js";

type CreateVerificationPlanInput = {
  preparedRepository: PreparedRepository;

  reproductionCommand: string;
};

export function createVerificationPlan({
  preparedRepository,
  reproductionCommand,
}: CreateVerificationPlanInput): VerificationPlan {
  if (!reproductionCommand.trim()) {
    throw new Error("Reproduction command cannot be empty.");
  }

  return {
    reproduction: {
      label: "Reported bug reproduction",

      command: reproductionCommand.trim(),
    },

    fullSuite: {
      label: "Repository full test suite",

      command: preparedRepository.project.fullSuiteCommand,
    },
  };
}
