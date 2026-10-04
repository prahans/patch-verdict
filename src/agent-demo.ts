import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { styleText } from "node:util";

import {
  createSandbox,
  destroySandbox,
  runSandboxCommand,
  writeSandboxFile,
} from "./sandbox/e2b.js";
import { runMission } from "./mission/runner.js";
import { writeProofBundle } from "./proof/bundle.js";
import { createVerificationPlan } from "./verification/create-plan.js";

const SANDBOX_PROJECT = "/tmp/patchverdict";

const forceBaselineFailure = process.argv.includes("--fail-baseline");

const verificationPlan = createVerificationPlan({
  preparedRepository: {
    repositoryUrl: "fixture://divide-by-zero",

    baseCommit: "fixture-baseline",

    projectRoot: SANDBOX_PROJECT,

    project: {
      packageManager: "npm",

      testFramework: "vitest",

      installCommand: "npm install --no-audit --no-fund",

      fullSuiteCommand: "npm test",
    },
  },

  reproductionCommand:
    'npx vitest run tests/divide.test.ts -t "rejects division by zero"',

  reproductionExpectation: {
    expectedExitCodes: [1],

    requiredOutput: forceBaselineFailure
      ? ["THIS_MARKER_DOES_NOT_EXIST"]
      : ["rejects division by zero", "expected [Function] to throw"],

    forbiddenOutput: ["Startup Error"],
  },
});

async function readFixtureFile(relativePath: string) {
  return readFile(
    path.resolve(process.cwd(), "fixtures", "divide-by-zero", relativePath),
    "utf8",
  );
}

async function main() {
  console.log(styleText(["bold", "cyan"], "\n  PATCHVERDICT"));
  console.log(styleText("dim", "  AI patch verification"));
  console.log(
    styleText("dim", "  ──────────────────────────────────────────────────"),
  );
  console.log(styleText("bold", "\n  01  Prepare repository\n"));

  const sandbox = await createSandbox();

  try {
    const packageJson = await readFixtureFile("package.json");
    const source = await readFixtureFile("src/divide.ts");
    const test = await readFixtureFile("tests/divide.test.ts");

    await writeSandboxFile(
      sandbox,
      `${SANDBOX_PROJECT}/package.json`,
      packageJson,
    );

    await writeSandboxFile(sandbox, `${SANDBOX_PROJECT}/src/divide.ts`, source);

    await writeSandboxFile(
      sandbox,
      `${SANDBOX_PROJECT}/tests/divide.test.ts`,
      test,
    );

    console.log(styleText("dim", "    Installing dependencies..."));

    const install = await runSandboxCommand(
      sandbox,
      "npm install --no-audit --no-fund",
      SANDBOX_PROJECT,
    );

    if (install.exitCode !== 0) {
      throw new Error("Dependency installation failed");
    }

    console.log(styleText("green", "    ✓  Repository ready"));

    const issue = `
divide() should reject division by zero.

Expected behavior:
divide(10, 0) should throw an error with the message "Division by zero".

Current behavior:
The function does not appear to reject division by zero.
`.trim();

    console.log("");
    console.log("Creating baseline Git commit...");

    const gitInit = await runSandboxCommand(
      sandbox,
      `
git init &&
git config user.email "patchverdict@local" &&
git config user.name "PatchVerdict" &&
printf "node_modules/\\n" > .gitignore &&
git add . &&
git commit -m "baseline"
`,
      SANDBOX_PROJECT,
    );

    if (gitInit.exitCode !== 0) {
      throw new Error(
        `Could not create baseline Git commit: ${gitInit.stderr}`,
      );
    }

    console.log("✓ Baseline Git commit created");

    console.log(styleText("bold", "\n  02  Run mission\n"));

    const missionInput = {
      issue,

      projectRoot: SANDBOX_PROJECT,

      verificationPlan,
    };

    const result = await runMission(sandbox, missionInput);

    console.log(
      result.investigation
        ? styleText("bold", "\n    Investigation report\n") +
            "\n    " +
            result.investigation.report.replace(/\r?\n/g, "\n    ") +
            styleText(
              "dim",
              `\n\n    Iterations: ${result.investigation.iterations}`,
            )
        : "",
    );

    console.log(styleText("bold", "\n  03  Mission result"));
    console.log(
      styleText("dim", "  ──────────────────────────────────────────────────"),
    );
    console.log(`    Execution           ${result.status}`);
    console.log(
      `    Verdict             ${styleText(
        result.verdict === "VERIFIED"
          ? ["bold", "green"]
          : result.verdict === "FAILED"
            ? ["bold", "red"]
            : "dim",
        result.verdict ?? "Not available",
      )}`,
    );
    console.log(
      `\n    Bug reproduced      ${
        result.checks === undefined
          ? styleText("dim", "—  Not available")
          : result.checks.bugReproducedBeforePatch
            ? styleText("green", "✓  Yes")
            : styleText("red", "✗  No")
      }`,
    );
    console.log(
      `    Patch applied       ${
        result.patch === undefined
          ? styleText("dim", "—  Not available")
          : result.patch.applied
            ? styleText("green", "✓  Yes")
            : styleText("red", "✗  No")
      }`,
    );
    console.log(
      `    Reproduction test   ${
        result.checks?.reproductionPassesAfterPatch === undefined
          ? styleText("dim", "—  Not available")
          : result.checks.reproductionPassesAfterPatch
            ? styleText("green", "✓  Passed")
            : styleText("red", "✗  Failed")
      }`,
    );
    console.log(
      `    Full test suite     ${
        result.checks?.fullSuitePassesAfterPatch === undefined
          ? styleText("dim", "—  Not available")
          : result.checks.fullSuitePassesAfterPatch
            ? styleText("green", "✓  Passed")
            : styleText("red", "✗  Failed")
      }`,
    );
    console.log(
      result.error
        ? styleText(
            "red",
            `\n    Error: ${result.error.replace(/\r?\n/g, "\n    ")}`,
          )
        : "",
    );
    console.log(
      styleText(
        "dim",
        "  ──────────────────────────────────────────────────\n",
      ),
    );

    const bundle = await writeProofBundle({
      missionId: "fixture-divide-zero",

      input: missionInput,

      result,
    });

    console.log("");
    console.log("PROOF BUNDLE");

    console.log("────────────────────────────");

    console.log(`✓ ${bundle.outputDirectory}`);
  } finally {
    await destroySandbox(sandbox);
  }
}

main().catch((error) => {
  console.error(
    styleText(["bold", "red"], "\n  ✗  Agent demo failed\n", {
      stream: process.stderr,
    }),
  );
  console.error(error);

  process.exitCode = 1;
});
