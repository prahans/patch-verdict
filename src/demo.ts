import "dotenv/config";

import { readFile, writeFile } from "node:fs/promises";
import { determineVerdict } from "./proof/verdict.js";
import path from "node:path";
import {
  createSandbox,
  destroySandbox,
  runSandboxCommand,
  writeSandboxFile,
} from "./sandbox/e2b.js";

const FIXED_DIVIDE_SOURCE = `
export function divide(
  a: number,
  b: number,
): number {
  if (b === 0) {
    throw new Error("Division by zero");
  }

  return a / b;
}
`.trimStart();

const SANDBOX_PROJECT = "/tmp/patchverdict";

async function readFixtureFile(relativePath: string) {
  const localPath = path.resolve(
    process.cwd(),
    "fixtures",
    "divide-by-zero",
    relativePath,
  );

  return readFile(localPath, "utf8");
}

async function main() {
  const reproductionCommand =
    'npx vitest run tests/divide.test.ts -t "rejects division by zero"';

  console.log("");
  console.log("PATCHVERDICT");
  console.log("────────────────────────────");
  console.log("");

  console.log("Creating E2B sandbox...");

  const sandbox = await createSandbox();

  console.log(`✓ Sandbox created: ${sandbox.sandboxId}`);

  try {
    /*
     * STEP 1
     * Check that Node/npm exist inside the sandbox.
     */
    console.log("");
    console.log("Checking sandbox environment...");

    const environment = await runSandboxCommand(
      sandbox,
      "node --version && npm --version",
      "/tmp",
    );

    if (environment.exitCode !== 0) {
      throw new Error(
        `Node/npm unavailable in sandbox:\n${environment.stderr}`,
      );
    }

    console.log(environment.stdout.trim());

    /*
     * STEP 2
     * Read our broken fixture from our local computer.
     */
    console.log("");
    console.log("Reading local fixture...");

    const packageJson = await readFixtureFile("package.json");

    const divideSource = await readFixtureFile("src/divide.ts");

    const divideTest = await readFixtureFile("tests/divide.test.ts");

    console.log("✓ Fixture loaded");

    /*
     * STEP 3
     * Copy those files into the E2B sandbox.
     *
     * E2B creates missing directories when writing
     * individual files.
     */
    console.log("");
    console.log("Uploading fixture to sandbox...");

    await writeSandboxFile(
      sandbox,
      `${SANDBOX_PROJECT}/package.json`,
      packageJson,
    );

    await writeSandboxFile(
      sandbox,
      `${SANDBOX_PROJECT}/src/divide.ts`,
      divideSource,
    );

    await writeSandboxFile(
      sandbox,
      `${SANDBOX_PROJECT}/tests/divide.test.ts`,
      divideTest,
    );

    console.log("✓ Fixture uploaded");

    /*
     * STEP 4
     * Install fixture dependencies inside E2B.
     */
    console.log("");
    console.log("Installing dependencies...");

    const install = await runSandboxCommand(
      sandbox,
      "npm install --no-audit --no-fund",
      SANDBOX_PROJECT,
    );

    if (install.exitCode !== 0) {
      console.error("Dependency installation failed:");
      console.error(install.stderr);
      return;
    }

    console.log("✓ Dependencies installed");

    /*
     * STEP 5
     * Run the broken tests.
     *
     * We EXPECT this command to fail.
     */
    console.log("");
    console.log("Running tests BEFORE patch...");
    console.log("");

    const before = await runSandboxCommand(
      sandbox,
      reproductionCommand,
      SANDBOX_PROJECT,
    );

    console.log(before.stdout);

    if (before.stderr) {
      console.error(before.stderr);
    }

    /*
     * STEP 6
     * Interpret the result.
     */

    console.log("");
    console.log("────────────────────────────");

    const beforeOutput = `${before.stdout}\n${before.stderr}`;

    const testRunnerStarted = beforeOutput.includes("Test Files");

    const reproductionTestRan = beforeOutput.includes(
      "rejects division by zero",
    );

    const infrastructureFailed = beforeOutput.includes("Startup Error");

    const bugReproduced =
      before.exitCode !== 0 &&
      testRunnerStarted &&
      reproductionTestRan &&
      !infrastructureFailed;

    if (!bugReproduced) {
      console.log("✗ BUG NOT REPRODUCED");
      console.log(
        "Stopping mission because the reported failure was not proven.",
      );

      return;
    }

    console.log("✓ BUG REPRODUCED");
    console.log("");
    // ------------------------------------
    // APPLY PATCH HERE
    // ------------------------------------
    console.log("Applying candidate patch...");

    await writeSandboxFile(
      sandbox,
      `${SANDBOX_PROJECT}/src/divide.ts`,
      FIXED_DIVIDE_SOURCE,
    );

    const patchApplied = true;

    console.log("✓ Patch applied: src/divide.ts");

    console.log("");
    console.log("Running reproduction test AFTER patch...");

    const afterReproduction = await runSandboxCommand(
      sandbox,
      reproductionCommand,
      SANDBOX_PROJECT,
    );

    console.log(afterReproduction.stdout);

    if (afterReproduction.stderr) {
      console.error(afterReproduction.stderr);
    }

    const reproductionPassesAfterPatch = afterReproduction.exitCode === 0;

    if (reproductionPassesAfterPatch) {
      console.log("✓ REPRODUCTION TEST NOW PASSES");
    } else {
      console.log("✗ PATCH DID NOT FIX REPRODUCTION");
    }

    console.log("");
    console.log("Running full test suite AFTER patch...");
    console.log("");

    const fullSuite = await runSandboxCommand(
      sandbox,
      "npm test",
      SANDBOX_PROJECT,
    );

    console.log(fullSuite.stdout);

    if (fullSuite.stderr) {
      console.error(fullSuite.stderr);
    }

    const fullSuitePassesAfterPatch = fullSuite.exitCode === 0;

    if (fullSuitePassesAfterPatch) {
      console.log("✓ FULL TEST SUITE PASSES");
    } else {
      console.log("✗ FULL TEST SUITE FAILED");
    }

    const verdict = determineVerdict({
      bugReproducedBeforePatch: bugReproduced,

      patchApplied: true,

      reproductionPassesAfterPatch,

      fullSuitePassesAfterPatch,

      // This legacy demo applies a trusted/manual patch rather than
      // an autonomous candidate patch that needs integrity analysis.
      verificationIntegrityPreserved: true,
    });

    console.log("");
    console.log("════════════════════════════");

    console.log("PATCH VERDICT");

    console.log("════════════════════════════");

    console.log("");

    console.log(`Bug reproduced before patch: ${bugReproduced ? "✓" : "✗"}`);

    console.log(`Patch applied: ${patchApplied ? "✓" : "✗"}`);

    console.log(
      `Reproduction passes after patch: ${
        reproductionPassesAfterPatch ? "✓" : "✗"
      }`,
    );

    console.log(
      `Full suite passes after patch: ${fullSuitePassesAfterPatch ? "✓" : "✗"}`,
    );

    console.log("");

    console.log(`VERDICT: ${verdict.status}`);

    console.log("════════════════════════════");

    const proof = {
      version: 1,

      mission: {
        id: "fixture-divide-zero",
        issue: "divide() should reject division by zero",
      },

      patch: {
        filesChanged: ["src/divide.ts"],
      },

      evidence: {
        beforePatch: before,

        afterPatchReproduction: afterReproduction,

        afterPatchFullSuite: fullSuite,
      },

      verdict,
    };

    const proofPath = path.resolve(process.cwd(), "output", "proof.json");

    await writeFile(proofPath, JSON.stringify(proof, null, 2), "utf8");

    console.log("");
    console.log("✓ Proof written to output/proof.json");
  } finally {
    /*
     * Always destroy the sandbox.
     *
     * This runs even if something above throws.
     */
    console.log("");
    console.log("Destroying sandbox...");

    await destroySandbox(sandbox);

    console.log("✓ Sandbox destroyed");
  }
}

main().catch((error) => {
  console.error("");
  console.error("PatchVerdict demo failed:");
  console.error(error);

  process.exitCode = 1;
});
