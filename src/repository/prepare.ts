import type { Sandbox } from "e2b";

import { runSandboxCommand } from "../sandbox/e2b.js";

import { cloneRepository } from "./clone.js";

import { detectProject } from "./detect-project.js";

import type { PreparedRepository, RepositoryRequest } from "./types.js";
import { RepositoryPreparationError } from "./errors.js";
export { RepositoryPreparationError } from "./errors.js";

async function ensurePnpmAvailable(
  sandbox: Sandbox,
  projectRoot: string,
): Promise<void> {
  const existing = await runSandboxCommand(
    sandbox,
    "pnpm --version",
    projectRoot,
  );

  if (existing.exitCode === 0) {
    return;
  }

  const corepack = await runSandboxCommand(
    sandbox,
    "corepack enable",
    projectRoot,
  );

  if (corepack.exitCode !== 0) {
    throw new Error(
      `pnpm is required but could not be enabled with Corepack: ${
        corepack.stderr || corepack.stdout
      }`,
    );
  }

  const verify = await runSandboxCommand(
    sandbox,
    "pnpm --version",
    projectRoot,
  );

  if (verify.exitCode !== 0) {
    throw new Error(
      "pnpm is required by this repository but is not available in the sandbox.",
    );
  }
}

async function verifyHeadUnchanged(
  sandbox: Sandbox,
  projectRoot: string,
  expectedCommit: string,
): Promise<void> {
  const head = await runSandboxCommand(
    sandbox,
    "git rev-parse HEAD",
    projectRoot,
  );

  if (head.exitCode !== 0) {
    throw new Error(
      "Could not verify repository HEAD after dependency installation.",
    );
  }

  const actualCommit = head.stdout.trim();

  if (actualCommit !== expectedCommit) {
    throw new Error(
      `Repository HEAD changed during preparation. Expected ${expectedCommit}, received ${actualCommit}.`,
    );
  }
}

async function verifyTrackedFilesClean(
  sandbox: Sandbox,
  projectRoot: string,
  strict = false,
): Promise<void> {
  const status = await runSandboxCommand(
    sandbox,
    strict ? "git status --porcelain --untracked-files=all" : "git status --porcelain --untracked-files=no",
    projectRoot,
  );

  if (status.exitCode !== 0) {
    throw new Error(
      "Could not verify repository state after dependency installation.",
    );
  }

  if (status.stdout.trim()) {
    throw new Error(
      `Dependency installation modified tracked repository files:\n${status.stdout.trim()}`,
    );
  }
}

export async function prepareRepository(
  sandbox: Sandbox,
  request: RepositoryRequest,
): Promise<PreparedRepository> {
  try {
  const checkout = await cloneRepository(sandbox, request);

  const project = await detectProject(sandbox, checkout.projectRoot, request);

  if (project.packageManager === "pnpm") {
    await ensurePnpmAvailable(sandbox, checkout.projectRoot);
  }

  const install = await runSandboxCommand(
    sandbox,
    project.installCommand,
    checkout.projectRoot,
  );

  if (install.exitCode !== 0) {
    throw new Error(
      `Dependency installation failed using "${project.installCommand}": ${
        install.stderr || install.stdout
      }`,
    );
  }

  await verifyHeadUnchanged(sandbox, checkout.projectRoot, checkout.baseCommit);

  await verifyTrackedFilesClean(sandbox, checkout.projectRoot, request.mode === "THIRD_PARTY_JS_TS");

  return {
    repositoryUrl: checkout.repositoryUrl,
    ...(checkout.mode && { mode: checkout.mode }),
    ...(checkout.targetBranch && { targetBranch: checkout.targetBranch }),

    ...(checkout.requestedRef && {
      requestedRef: checkout.requestedRef,
    }),

    baseCommit: checkout.baseCommit,

    projectRoot: checkout.projectRoot,

    project,
  };
  } catch (error) {
    if (request.mode !== "THIRD_PARTY_JS_TS" || error instanceof RepositoryPreparationError) throw error;
    throw new RepositoryPreparationError("PREPARATION_FAILED", error instanceof Error ? error.message : "Repository preparation failed.");
  }
}
