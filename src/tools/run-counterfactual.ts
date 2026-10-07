import path from "node:path";
import { z } from "zod";
import type { Sandbox } from "e2b";

import type { CommandEvidence } from "../evidence/command-evidence.js";
import {
  readSandboxFile,
  runSandboxCommand,
  writeSandboxFile,
} from "../sandbox/e2b.js";

const counterfactualInputSchema = z
  .object({
    experimentId: z
      .string()
      .trim()
      .regex(/^EXP-[1-9]\d*$/, "Expected an experiment id such as EXP-1."),

    hypothesisIds: z
      .array(
        z
          .string()
          .trim()
          .regex(/^H[1-5]$/, "Expected hypothesis ids such as H1 or H2."),
      )
      .min(2)
      .max(5),

    question: z.string().trim().min(10).max(1500),

    path: z.string().trim().min(1).max(500),

    find: z.string().min(1).max(4000),

    replace: z.string().max(4000),
  })
  .strict();

export type CounterfactualInput = z.infer<
  typeof counterfactualInputSchema
>;

export type CounterfactualOutcome =
  | "FAILURE_REMOVED"
  | "FAILURE_PERSISTS"
  | "INCONCLUSIVE";

export type CounterfactualInterventionRole =
  | "RUNNER_CONFIGURATION"
  | "TEST_SETUP_CONTROL";

export type CounterfactualExperimentEvidence = {
  experimentId: string;
  evidenceSource: string;
  hypothesisIds: string[];
  question: string;

  intervention: {
    path: string;
    role: CounterfactualInterventionRole;
    find: string;
    replace: string;
  };

  command: CommandEvidence;

  outcome: CounterfactualOutcome;

  repositoryRestored: true;
};

type CounterfactualAccess = {
  readFile: (repositoryRelativePath: string) => Promise<string>;
  writeFile: (
    repositoryRelativePath: string,
    content: string,
  ) => Promise<void>;
  runTrustedCommand: () => Promise<CommandEvidence>;
  assertRepositoryClean: (phase: "before" | "after") => Promise<void>;
};

type CounterfactualContext = {
  trustedCommand: string;
  baselineExitCode: number;
  requiredOutput: readonly string[];
  runnerConfigPaths: readonly string[];
  testSetupPaths: readonly string[];
};

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function assertSafeRelativePath(value: string) {
  const normalized = path.posix.normalize(normalizePath(value));

  if (
    normalized.startsWith("../") ||
    normalized === ".." ||
    path.posix.isAbsolute(normalized)
  ) {
    throw new Error("Counterfactual path must stay inside the repository.");
  }

  return normalized;
}

function countOccurrences(haystack: string, needle: string) {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let offset = 0;

  while (true) {
    const index = haystack.indexOf(needle, offset);

    if (index === -1) {
      return count;
    }

    count += 1;
    offset = index + needle.length;
  }
}

function classifyOutcome(
  evidence: CommandEvidence,
  context: CounterfactualContext,
): CounterfactualOutcome {
  const output = [evidence.stdout, evidence.stderr]
    .filter(Boolean)
    .join("\n");

  if (evidence.exitCode === 0) {
    return "FAILURE_REMOVED";
  }

  if (context.requiredOutput.length > 0) {
    const stillContainsBaselineMarkers = context.requiredOutput.every(
      (marker) => output.includes(marker),
    );

    return stillContainsBaselineMarkers
      ? "FAILURE_PERSISTS"
      : "INCONCLUSIVE";
  }

  return evidence.exitCode === context.baselineExitCode
    ? "FAILURE_PERSISTS"
    : "INCONCLUSIVE";
}

export async function runCounterfactualWithAccess(input: {
  request: unknown;
  context: CounterfactualContext;
  access: CounterfactualAccess;
}): Promise<CounterfactualExperimentEvidence> {
  const parsed = counterfactualInputSchema.parse(input.request);

  const normalizedPath = assertSafeRelativePath(parsed.path);

  const runnerConfigPaths = new Set(
    input.context.runnerConfigPaths.map(normalizePath),
  );

  const testSetupPaths = new Set(
    input.context.testSetupPaths.map(normalizePath),
  );

  let interventionRole: CounterfactualInterventionRole;

  if (runnerConfigPaths.has(normalizedPath)) {
    interventionRole = "RUNNER_CONFIGURATION";
  } else if (testSetupPaths.has(normalizedPath)) {
    interventionRole = "TEST_SETUP_CONTROL";
  } else {
    throw new Error(
      [
        `Counterfactual experiment path "${parsed.path}" is not allowlisted.`,
        "Milestone 3 permits temporary interventions only on deterministic reconnaissance runner-config or shared test-setup files.",
      ].join(" "),
    );
  }

  if (parsed.find === parsed.replace) {
    throw new Error(
      "Counterfactual experiment must change the selected causal variable.",
    );
  }

  const uniqueHypothesisIds = new Set(parsed.hypothesisIds);

  if (uniqueHypothesisIds.size !== parsed.hypothesisIds.length) {
    throw new Error(
      "Counterfactual experiment hypothesisIds must not contain duplicates.",
    );
  }

  await input.access.assertRepositoryClean("before");

  const original = await input.access.readFile(normalizedPath);

  const occurrences = countOccurrences(original, parsed.find);

  if (occurrences !== 1) {
    throw new Error(
      `Counterfactual find text must match exactly once in "${normalizedPath}", but matched ${occurrences} time(s).`,
    );
  }

  const mutated = original.replace(parsed.find, () => parsed.replace);

  let commandEvidence: CommandEvidence | undefined;
  let experimentError: unknown;

  try {
    await input.access.writeFile(normalizedPath, mutated);

    const observed = await input.access.readFile(normalizedPath);

    if (observed !== mutated) {
      throw new Error(
        "Counterfactual intervention could not be verified after writing.",
      );
    }

    commandEvidence = await input.access.runTrustedCommand();

    if (commandEvidence.command.trim() !== input.context.trustedCommand.trim()) {
      throw new Error(
        "Counterfactual experiment executed a command other than the trusted reproduction command.",
      );
    }
  } catch (error) {
    experimentError = error;
  } finally {
    let restoreError: unknown;

    try {
      await input.access.writeFile(normalizedPath, original);

      const restored = await input.access.readFile(normalizedPath);

      if (restored !== original) {
        throw new Error(
          "Counterfactual experiment failed to restore the original file bytes.",
        );
      }

      await input.access.assertRepositoryClean("after");
    } catch (error) {
      restoreError = error;
    }

    if (restoreError) {
      const message =
        restoreError instanceof Error
          ? restoreError.message
          : "Unknown restoration error";

      throw new Error(
        `Counterfactual experiment restoration failed closed: ${message}`,
      );
    }
  }

  if (experimentError) {
    throw experimentError;
  }

  if (!commandEvidence) {
    throw new Error(
      "Counterfactual experiment produced no trusted command evidence.",
    );
  }

  return {
    experimentId: parsed.experimentId,
    evidenceSource: parsed.experimentId,
    hypothesisIds: parsed.hypothesisIds,
    question: parsed.question,

    intervention: {
      path: normalizedPath,
      role: interventionRole,
      find: parsed.find,
      replace: parsed.replace,
    },

    command: commandEvidence,

    outcome: classifyOutcome(commandEvidence, input.context),

    repositoryRestored: true,
  };
}

export async function runCounterfactualExperiment(
  sandbox: Sandbox,
  request: unknown,
  context: CounterfactualContext & {
    projectRoot: string;
  },
): Promise<CounterfactualExperimentEvidence> {
  return runCounterfactualWithAccess({
    request,
    context,

    access: {
      readFile: (repositoryRelativePath) =>
        readSandboxFile(
          sandbox,
          path.posix.join(context.projectRoot, repositoryRelativePath),
        ),

      writeFile: (repositoryRelativePath, content) =>
        writeSandboxFile(
          sandbox,
          path.posix.join(context.projectRoot, repositoryRelativePath),
          content,
        ),

      runTrustedCommand: () =>
        runSandboxCommand(
          sandbox,
          context.trustedCommand,
          context.projectRoot,
        ),

      assertRepositoryClean: async (phase) => {
        const result = await runSandboxCommand(
          sandbox,
          "git diff --no-ext-diff --quiet -- . && git diff --cached --no-ext-diff --quiet -- .",
          context.projectRoot,
        );

        if (result.exitCode === 0) {
          return;
        }

        if (result.exitCode === 1) {
          throw new Error(
            `Repository has tracked changes ${phase} counterfactual experiment.`,
          );
        }

        throw new Error(
          result.stderr ||
            `Could not verify repository cleanliness ${phase} counterfactual experiment.`,
        );
      },
    },
  });
}
