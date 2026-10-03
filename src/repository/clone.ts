import type { Sandbox } from "e2b";

import { runSandboxCommand } from "../sandbox/e2b.js";

import type { RepositoryCheckout, RepositoryRequest } from "./types.js";

const PROJECT_ROOT = "/tmp/patchverdict";

const CLONE_PARENT = "/tmp";

function normalizeGitHubRepositoryUrl(input: string): string {
  let url: URL;

  try {
    url = new URL(input);
  } catch {
    throw new Error("Repository URL is not a valid URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS GitHub repository URLs are supported.");
  }

  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") {
    throw new Error(
      "PatchVerdict currently supports public GitHub repositories only.",
    );
  }

  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");

  if (segments.length !== 2) {
    throw new Error(
      "Repository URL must point directly to a GitHub repository, for example https://github.com/owner/repo.",
    );
  }

  const owner = segments[0];

  let repository = segments[1];

  if (repository?.endsWith(".git")) {
    repository = repository.slice(0, -4);
  }

  if (!owner || !repository) {
    throw new Error("Repository URL is missing an owner or repository name.");
  }

  if (!/^[A-Za-z0-9-]+$/.test(owner)) {
    throw new Error("GitHub repository owner contains unsupported characters.");
  }

  if (!/^[A-Za-z0-9._-]+$/.test(repository)) {
    throw new Error("GitHub repository name contains unsupported characters.");
  }

  return `https://github.com/` + `${owner}/` + `${repository}.git`;
}

function validateRef(ref: string): string {
  const trimmed = ref.trim();

  if (!trimmed) {
    throw new Error("Repository ref cannot be empty.");
  }

  if (trimmed.length > 200) {
    throw new Error("Repository ref is too long.");
  }

  if (!/^[A-Za-z0-9._/-]+$/.test(trimmed)) {
    throw new Error("Repository ref contains unsupported characters.");
  }

  if (
    trimmed.startsWith("-") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("..") ||
    trimmed.includes("//")
  ) {
    throw new Error("Repository ref is not valid.");
  }

  return trimmed;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function resolveRequestedRef(
  sandbox: Sandbox,
  ref: string,
): Promise<string> {
  const quotedRef = shellQuote(`${ref}^{commit}`);

  const direct = await runSandboxCommand(
    sandbox,
    `git rev-parse --verify --quiet ${quotedRef}`,
    PROJECT_ROOT,
  );

  if (direct.exitCode === 0) {
    return direct.stdout.trim();
  }

  const quotedRemoteRef = shellQuote(`origin/${ref}^{commit}`);

  const remote = await runSandboxCommand(
    sandbox,
    `git rev-parse --verify --quiet ${quotedRemoteRef}`,
    PROJECT_ROOT,
  );

  if (remote.exitCode === 0) {
    return remote.stdout.trim();
  }

  throw new Error(`Requested Git ref "${ref}" could not be resolved.`);
}

export async function cloneRepository(
  sandbox: Sandbox,
  request: RepositoryRequest,
): Promise<RepositoryCheckout> {
  const repositoryUrl = normalizeGitHubRepositoryUrl(request.repositoryUrl);

  const requestedRef = request.ref ? validateRef(request.ref) : undefined;

  const clone = await runSandboxCommand(
    sandbox,
    `git clone ${shellQuote(repositoryUrl)} ${shellQuote(PROJECT_ROOT)}`,
    CLONE_PARENT,
  );

  if (clone.exitCode !== 0) {
    throw new Error(
      `Could not clone repository: ${clone.stderr || clone.stdout}`,
    );
  }

  if (requestedRef) {
    const resolvedCommit = await resolveRequestedRef(sandbox, requestedRef);

    const checkout = await runSandboxCommand(
      sandbox,
      `git checkout --detach ${shellQuote(resolvedCommit)}`,
      PROJECT_ROOT,
    );

    if (checkout.exitCode !== 0) {
      throw new Error(
        `Could not checkout requested ref "${requestedRef}": ${
          checkout.stderr || checkout.stdout
        }`,
      );
    }
  }

  const head = await runSandboxCommand(
    sandbox,
    "git rev-parse HEAD",
    PROJECT_ROOT,
  );

  if (head.exitCode !== 0) {
    throw new Error("Could not determine repository base commit.");
  }

  const baseCommit = head.stdout.trim();

  if (!/^[0-9a-f]{40}$/i.test(baseCommit)) {
    throw new Error("Repository base commit is not a valid full Git SHA.");
  }

  const status = await runSandboxCommand(
    sandbox,
    "git status --porcelain",
    PROJECT_ROOT,
  );

  if (status.exitCode !== 0) {
    throw new Error("Could not verify repository working tree state.");
  }

  if (status.stdout.trim()) {
    throw new Error(
      "Repository working tree is not clean immediately after checkout.",
    );
  }

  return {
    repositoryUrl,
    ...(requestedRef && {
      requestedRef,
    }),
    baseCommit,
    projectRoot: PROJECT_ROOT,
  };
}
