import "dotenv/config";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  createSandbox,
  destroySandbox,
  runSandboxCommand,
  writeSandboxFile,
} from "./sandbox/e2b.js";

import { investigateIssue } from "./agent/investigate.js";
import { patchIssue } from "./agent/patch.js";
import { executeTool } from "./tools/index.js";
import { determineVerdict } from "./proof/verdict.js";
import { runFullSuiteTool } from "./tools/run-full-suite.js";

const SANDBOX_PROJECT = "/tmp/patchverdict";

async function readFixtureFile(relativePath: string) {
  return readFile(
    path.resolve(process.cwd(), "fixtures", "divide-by-zero", relativePath),
    "utf8",
  );
}

async function main() {
  console.log(`
  ╭──────────────────────────────────────────────────╮
  │  PATCHVERDICT                                    │
  │  AI patch verification                           │
  ╰──────────────────────────────────────────────────╯`);
  console.log("\n  [1/6] Prepare repository\n  ──────────────────────────────────────────────────");

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

    console.log("    Installing dependencies...");

    const install = await runSandboxCommand(
      sandbox,
      "npm install --no-audit --no-fund",
      SANDBOX_PROJECT,
    );

    if (install.exitCode !== 0) {
      throw new Error("Dependency installation failed");
    }

    console.log("    ✓  Repository ready");

    const issue = `
divide() should reject division by zero.

Expected behavior:
divide(10, 0) should throw an error with the message "Division by zero".

Current behavior:
The function does not appear to reject division by zero.
`.trim();

    console.log("\n    Reported issue\n");
    console.log(`    ${issue.replace(/\r?\n/g, "\n    ")}`);

    console.log("\n  [2/6] Reproduce reported bug\n  ──────────────────────────────────────────────────");

    const beforePatch = await executeTool(sandbox, "run_test", {
      testName: "rejects division by zero",
    });

    if (!beforePatch.ok) {
      throw new Error(`Could not run baseline test: ${beforePatch.error}`);
    }

    if (!("exitCode" in beforePatch.data)) {
      throw new Error("Baseline test result is missing an exit code");
    }

    const beforeOutput = `${beforePatch.data.stdout}\n${beforePatch.data.stderr}`;

    const bugReproducedBeforePatch =
      beforePatch.data.exitCode !== 0 &&
      beforeOutput.includes("rejects division by zero") &&
      beforeOutput.includes("expected [Function] to throw") &&
      !beforeOutput.includes("Startup Error");

    if (!bugReproducedBeforePatch) {
      throw new Error("Reported bug could not be reproduced before patching.");
    }

    console.log("    ✓  Baseline bug reproduced");

    console.log("\n  [3/6] Investigate issue\n  ──────────────────────────────────────────────────");

    const investigation = await investigateIssue(sandbox, issue);

    if (!investigation.completed) {
      throw new Error("AI investigation did not complete successfully.");
    }

    console.log("\n    Investigation report\n");
    console.log(`    ${investigation.report.replace(/\r?\n/g, "\n    ")}`);
    console.log(`\n    Iterations: ${investigation.iterations}`);

    console.log("\n  [4/6] Apply candidate patch\n  ──────────────────────────────────────────────────");

    const patch = await patchIssue(sandbox, issue, investigation.report);

    if (!patch.patchApplied) {
      throw new Error("AI did not produce a candidate patch.");
    }

    console.log(`    ${patch.patchApplied ? "✓" : "✗"}  Candidate patch applied`);
    console.log("    Reading patched source...");

    const changedSource = await executeTool(sandbox, "read_file", {
      path: "src/divide.ts",
    });

    if (!changedSource.ok) {
      throw new Error(
        `Could not inspect patched source: ${changedSource.error}`,
      );
    }

    if (!("content" in changedSource.data)) {
      throw new Error("Patched source result is missing file content");
    }

    console.log("\n    Patched source · src/divide.ts\n");
    console.log(`    ${changedSource.data.content.replace(/\r?\n/g, "\n    ")}`);

    console.log("\n  [5/6] Verify candidate patch\n  ──────────────────────────────────────────────────");
    console.log("    Running reproduction test...");

    const afterPatchReproduction = await executeTool(sandbox, "run_test", {
      testName: "rejects division by zero",
    });

    if (!afterPatchReproduction.ok) {
      throw new Error(
        `Could not run reproduction test: ${afterPatchReproduction.error}`,
      );
    }

    if (!("exitCode" in afterPatchReproduction.data)) {
      throw new Error("Reproduction test result is missing an exit code");
    }

    const reproductionPassesAfterPatch =
      afterPatchReproduction.data.exitCode === 0;

    console.log(
      reproductionPassesAfterPatch
        ? "    ✓  Reproduction test passes"
        : "    ✗  Reproduction test still fails",
    );

    console.log("\n    Running full test suite...");

    const fullSuite = await runFullSuiteTool(sandbox);

    if (!fullSuite.ok) {
      throw new Error(`Full test suite could not execute: ${fullSuite.error}`);
    }

    const fullSuitePassesAfterPatch = fullSuite.data.exitCode === 0;

    console.log(
      fullSuitePassesAfterPatch
        ? "    ✓  Full test suite passes"
        : "    ✗  Full test suite fails",
    );

    const verdict = determineVerdict({
      bugReproducedBeforePatch,
      patchApplied: patch.patchApplied,
      reproductionPassesAfterPatch,
      fullSuitePassesAfterPatch,
    });

    console.log("\n  [6/6] Patch verdict\n  ──────────────────────────────────────────────────");
    console.log(
      `    Bug reproduced     ${bugReproducedBeforePatch ? "✓  Yes" : "✗  No"}`,
    );
    console.log(
      `    Patch applied      ${patch.patchApplied ? "✓  Yes" : "✗  No"}`,
    );
    console.log(
      `    Reported bug fixed ${reproductionPassesAfterPatch ? "✓  Yes" : "✗  No"}`,
    );
    console.log(
      `    Full test suite    ${fullSuitePassesAfterPatch ? "✓  Pass" : "✗  Fail"}`,
    );
    console.log(`\n    VERDICT: ${verdict.status}`);
    console.log("  ──────────────────────────────────────────────────\n");
  } finally {
    await destroySandbox(sandbox);
  }
}

main().catch((error) => {
  console.error("\n  ✗  Agent demo failed\n  ──────────────────────────────────────────────────");
  console.error(error);

  process.exitCode = 1;
});
