import "dotenv/config";

import { readFile } from "node:fs/promises";

import path from "node:path";

import {
  createSandbox,
  destroySandbox,
  runSandboxCommand,
  writeSandboxFile,
} from "./sandbox/e2b.js";

import { executeTool } from "./tools/index.js";

const SANDBOX_PROJECT = "/tmp/patchverdict";

async function readFixtureFile(relativePath: string) {
  return readFile(
    path.resolve(process.cwd(), "fixtures", "divide-by-zero", relativePath),
    "utf8",
  );
}

async function main() {
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

    await runSandboxCommand(
      sandbox,
      "npm install --no-audit --no-fund",
      SANDBOX_PROJECT,
    );

    console.log("\nLIST FILES\n");

    console.dir(
      await executeTool(sandbox, "list_files", {
        depth: 3,
      }),
      {
        depth: null,
      },
    );

    console.log("\nREAD FILE\n");

    console.dir(
      await executeTool(sandbox, "read_file", {
        path: "src/divide.ts",
      }),
      {
        depth: null,
      },
    );

    console.log("\nSEARCH CODE\n");

    console.dir(
      await executeTool(sandbox, "search_code", {
        query: "divide",
      }),
      {
        depth: null,
      },
    );

    console.log("\nRUN TEST\n");

    console.dir(
      await executeTool(sandbox, "run_test", {
        testName: "rejects division by zero",
      }),
      {
        depth: null,
      },
    );
  } finally {
    await destroySandbox(sandbox);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
