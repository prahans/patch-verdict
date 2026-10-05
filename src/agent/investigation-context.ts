export type InvestigationBaselineContext = {
  command: string;

  exitCode: number;

  reproduced: true;

  requiredOutput: string[];

  outputExcerpt: string;
};

const MAX_OUTPUT_EXCERPT = 6000;

export function createInvestigationBaselineContext(input: {
  command: string;

  exitCode: number;

  stdout: string;

  stderr: string;

  requiredOutput?: string[];
}): InvestigationBaselineContext {
  const combined = [input.stdout, input.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();

  /*
   * Failure summaries and stack traces are
   * commonly near the end of test output.
   */
  const outputExcerpt =
    combined.length <= MAX_OUTPUT_EXCERPT
      ? combined
      : combined.slice(-MAX_OUTPUT_EXCERPT);

  return {
    command: input.command,

    exitCode: input.exitCode,

    reproduced: true,

    requiredOutput: input.requiredOutput ?? [],

    outputExcerpt,
  };
}
