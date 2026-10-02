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
import { runMission } from "./mission/runner.js";

const SANDBOX_PROJECT = "/tmp/patchverdict";

async function readFixtureFile(relativePath: string) {
  return readFile(
    path.resolve(process.cwd(), "fixtures", "divide-by-zero", relativePath),
    "utf8",
  );
}

async function main() {
  console.log(`PATCHVERDICT AI patch verification`);
  console.log(
    "\n Prepare repository\n  ──────────────────────────────────────────────────",
  );

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

    const result = await runMission(sandbox, {
      issue,

      reproductionTestName: "rejects division by zero",
    });

    console.log("");
    console.log("════════════════════════════");

    console.log("MISSION RESULT");

    console.log("════════════════════════════");

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await destroySandbox(sandbox);
  }
}

main().catch((error) => {
  console.error(
    "\n  ✗  Agent demo failed\n  ──────────────────────────────────────────────────",
  );
  console.error(error);

  process.exitCode = 1;
});
