export type VerificationCommand = {
  command: string;
  label: string;
};

export type ReproductionExpectation = {
  expectedExitCodes: number[];

  requiredOutput?: string[];

  forbiddenOutput?: string[];
};

export type ReproductionVerificationCommand = VerificationCommand & {
  expectation: ReproductionExpectation;
};

export type VerificationPlan = {
  reproduction: ReproductionVerificationCommand;

  fullSuite: VerificationCommand;
};
