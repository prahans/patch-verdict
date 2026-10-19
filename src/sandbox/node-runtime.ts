import type { Sandbox } from "e2b";

import {
  registerSandboxRuntimeBin,
  runSandboxCommand,
} from "./e2b.js";

export const PATCHVERDICT_NODE_VERSION = "22.14.0";
export const PATCHVERDICT_NODE_RUNTIME_ROOT =
  `/tmp/patchverdict-node-v${PATCHVERDICT_NODE_VERSION}`;
export const PATCHVERDICT_NODE_RUNTIME_BIN =
  `${PATCHVERDICT_NODE_RUNTIME_ROOT}/bin`;

type RuntimeArtifact = {
  archiveName: string;
  sha256: string;
};

const RUNTIME_ARTIFACTS: Record<string, RuntimeArtifact> = {
  x86_64: {
    archiveName: `node-v${PATCHVERDICT_NODE_VERSION}-linux-x64.tar.gz`,
    sha256:
      "9d942932535988091034dc94cc5f42b6dc8784d6366df3a36c4c9ccb3996f0c2",
  },
  aarch64: {
    archiveName: `node-v${PATCHVERDICT_NODE_VERSION}-linux-arm64.tar.gz`,
    sha256:
      "8cf30ff7250f9463b53c18f89c6c606dfda70378215b2c905d0a9a8b08bd45e0",
  },
  arm64: {
    archiveName: `node-v${PATCHVERDICT_NODE_VERSION}-linux-arm64.tar.gz`,
    sha256:
      "8cf30ff7250f9463b53c18f89c6c606dfda70378215b2c905d0a9a8b08bd45e0",
  },
};

export type SandboxNodeRuntime = {
  nodeVersion: string;
  npmVersion: string;
  source: "PATCHVERDICT_PINNED_NODE_22";
};

export function pinnedNodeArtifactForMachine(
  machine: string,
): RuntimeArtifact | null {
  return RUNTIME_ARTIFACTS[machine] ?? null;
}

function boundedFailure(stdout: string, stderr: string) {
  return `${stderr}\n${stdout}`.replace(/\s+/g, " ").trim().slice(0, 800);
}

/**
 * Strict third-party missions use one PatchVerdict-owned Node runtime instead
 * of inheriting the E2B base image's Node version. This keeps dependency
 * installation and all later test commands on the same deterministic runtime.
 *
 * The official Node archive is pinned by version and SHA-256. Repository or
 * issue content cannot influence the download URL, checksum, install path, or
 * architecture mapping.
 */
export async function ensureThirdPartyNodeRuntime(
  sandbox: Sandbox,
): Promise<SandboxNodeRuntime> {
  const machine = await runSandboxCommand(sandbox, "uname -m", "/tmp", {
    useRuntime: false,
  });

  if (machine.exitCode !== 0) {
    throw new Error("Could not determine sandbox CPU architecture.");
  }

  const artifact = pinnedNodeArtifactForMachine(machine.stdout.trim());

  if (!artifact) {
    throw new Error(
      `Unsupported sandbox CPU architecture "${machine.stdout.trim()}". PatchVerdict currently supports x86_64 and arm64 E2B sandboxes.`,
    );
  }

  const expectedVersion = `v${PATCHVERDICT_NODE_VERSION}`;
  const existing = await runSandboxCommand(
    sandbox,
    `${PATCHVERDICT_NODE_RUNTIME_BIN}/node --version`,
    "/tmp",
    { useRuntime: false },
  );

  if (existing.exitCode !== 0 || existing.stdout.trim() !== expectedVersion) {
    const archivePath = `/tmp/${artifact.archiveName}`;
    const downloadUrl =
      `https://nodejs.org/dist/v${PATCHVERDICT_NODE_VERSION}/${artifact.archiveName}`;

    const install = await runSandboxCommand(
      sandbox,
      [
        "set -eu",
        "command -v curl >/dev/null",
        "command -v sha256sum >/dev/null",
        "command -v tar >/dev/null",
        `rm -rf '${PATCHVERDICT_NODE_RUNTIME_ROOT}' '${archivePath}'`,
        `curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error '${downloadUrl}' -o '${archivePath}'`,
        `printf '%s  %s\\n' '${artifact.sha256}' '${archivePath}' | sha256sum -c - >/dev/null`,
        `mkdir -m 700 '${PATCHVERDICT_NODE_RUNTIME_ROOT}'`,
        `tar -xzf '${archivePath}' --strip-components=1 --no-same-owner -C '${PATCHVERDICT_NODE_RUNTIME_ROOT}'`,
        `rm -f '${archivePath}'`,
        `test "$('${PATCHVERDICT_NODE_RUNTIME_BIN}/node' --version)" = '${expectedVersion}'`,
        `'${PATCHVERDICT_NODE_RUNTIME_BIN}/npm' --version >/dev/null`,
      ].join("; "),
      "/tmp",
      {
        useRuntime: false,
        timeoutMs: 3 * 60 * 1000,
      },
    );

    if (install.exitCode !== 0) {
      throw new Error(
        "PatchVerdict could not provision its pinned Node runtime. " +
          (boundedFailure(install.stdout, install.stderr) ||
            "The sandbox is missing a required bootstrap utility or could not download the official Node archive."),
      );
    }
  }

  registerSandboxRuntimeBin(sandbox, PATCHVERDICT_NODE_RUNTIME_BIN);

  const verify = await runSandboxCommand(
    sandbox,
    "node --version && npm --version",
    "/tmp",
  );

  if (verify.exitCode !== 0) {
    throw new Error(
      "PatchVerdict provisioned Node but could not activate the runtime.",
    );
  }

  const lines = verify.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines[0] !== expectedVersion || !/^\d+\.\d+\.\d+/.test(lines[1] ?? "")) {
    throw new Error(
      "PatchVerdict's activated Node runtime did not match the pinned version.",
    );
  }

  return {
    nodeVersion: lines[0],
    npmVersion: lines[1]!,
    source: "PATCHVERDICT_PINNED_NODE_22",
  };
}
