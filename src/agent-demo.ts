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

const SANDBOX_PROJECT = "/tmp/patchverdict";

async function readFixtureFile(relativePath: string) {
  return readFile(
    path.resolve(process.cwd(), "fixtures", "divide-by-zero", relativePath),
    "utf8",
  );
}

async function main() {
  console.log("");
  console.log("PATCHVERDICT");
  console.log("AI INVESTIGATION DEMO");
  console.log("────────────────────────────");

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

    console.log("");
    console.log("Installing dependencies...");

    const install = await runSandboxCommand(
      sandbox,
      "npm install --no-audit --no-fund",
      SANDBOX_PROJECT,
    );

    if (install.exitCode !== 0) {
      throw new Error("Dependency installation failed");
    }

    console.log("✓ Repository ready");

    const issue = `
divide() should reject division by zero.

Expected behavior:
divide(10, 0) should throw an error with the message "Division by zero".

Current behavior:
The function does not appear to reject division by zero.
`.trim();

    console.log("");
    console.log("ISSUE");
    console.log(issue);

    console.log("");
    console.log("Starting AI investigation...");

    const investigation = await investigateIssue(sandbox, issue);

    console.log("");
    console.log("════════════════════════════");

    console.log("INVESTIGATION REPORT");

    console.log("════════════════════════════");

    console.log("");
    console.log(investigation.report);

    console.log("");
    console.log(`Iterations: ${investigation.iterations}`);
  } finally {
    await destroySandbox(sandbox);
  }
}

main().catch((error) => {
  console.error("");
  console.error("Agent demo failed:");

  console.error(error);

  process.exitCode = 1;
});
