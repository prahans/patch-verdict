export type VerificationCommand = {
  command: string;

  /**
   * Human-readable purpose shown in evidence/UI.
   */
  label: string;
};

export type VerificationPlan = {
  reproduction: VerificationCommand;

  fullSuite: VerificationCommand;
};
