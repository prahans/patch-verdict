import "dotenv/config";

import { styleText } from "node:util";

import { createSandbox, destroySandbox } from "./sandbox/e2b.js";

import { prepareRepository } from "./repository/prepare.js";

async function main() {
  const repositoryUrl = process.argv[2];

  const ref = process.argv[3];

  if (!repositoryUrl) {
    throw new Error(
      [
        "Repository URL is required.",
        "",
        "Usage:",
        "pnpm repo:demo <repository-url> [ref]",
        "",
        "Example:",
        "pnpm repo:demo https://github.com/owner/repository main",
      ].join("\n"),
    );
  }

  console.log(styleText(["bold", "cyan"], "\nPATCHVERDICT"));

  console.log(styleText("dim", "Real repository preparation demo"));

  console.log(styleText("dim", "────────────────────────────────────────"));

  const sandbox = await createSandbox();

  try {
    console.log("");
    console.log("Preparing repository...");

    const prepared = await prepareRepository(sandbox, {
      repositoryUrl,

      ...(ref && {
        ref,
      }),
    });

    console.log("");
    console.log(styleText(["bold", "green"], "✓ Repository prepared"));

    console.log("");
    console.log(`Repository      ${prepared.repositoryUrl}`);

    console.log(
      `Requested ref   ${prepared.requestedRef ?? "default branch HEAD"}`,
    );

    console.log(`Base commit     ${prepared.baseCommit}`);

    console.log(`Project root    ${prepared.projectRoot}`);

    console.log(`Package manager ${prepared.project.packageManager}`);

    console.log(`Test framework  ${prepared.project.testFramework}`);

    console.log(`Install command ${prepared.project.installCommand}`);

    console.log(`Full suite      ${prepared.project.fullSuiteCommand}`);
  } finally {
    await destroySandbox(sandbox);
  }
}

main().catch((error) => {
  console.error("");
  console.error(
    styleText(["bold", "red"], "Repository preparation failed", {
      stream: process.stderr,
    }),
  );

  console.error(error instanceof Error ? error.message : error);

  process.exitCode = 1;
});
