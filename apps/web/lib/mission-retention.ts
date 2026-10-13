import "server-only";

import { readdir, rm, stat, unlink } from "node:fs/promises";

import path from "node:path";

import { resolveRepositoryRoot } from "./repository-root";

export const MAX_SAVED_WEB_MISSIONS = 20;

export const STALE_WEB_ARTIFACT_MS = 24 * 60 * 60 * 1000; // 24 hours

const WEB_MISSION_ID =
  /^web-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function missing(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

type CleanupOptions = {
  maxSavedMissions?: number;
  staleMs?: number;
  now?: number;
};

export async function cleanupMissionOutput(options: CleanupOptions = {}) {
  const maxSavedMissions = options.maxSavedMissions ?? MAX_SAVED_WEB_MISSIONS;

  const staleMs = options.staleMs ?? STALE_WEB_ARTIFACT_MS;

  const now = options.now ?? Date.now();

  const repositoryRoot = await resolveRepositoryRoot();

  const outputRoot = path.join(repositoryRoot, "output");

  let entries;

  try {
    entries = await readdir(outputRoot, {
      withFileTypes: true,
    });
  } catch (error) {
    if (missing(error)) {
      return;
    }

    throw error;
  }

  const completed: Array<{
    missionId: string;
    directory: string;
    completedAt: number;
  }> = [];

  const staleIncomplete: Array<{
    missionId: string;
    directory: string;
  }> = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !WEB_MISSION_ID.test(entry.name)) {
      continue;
    }

    const directory = path.join(outputRoot, entry.name);

    const proofFile = path.join(directory, "proof.json");

    try {
      const proofStats = await stat(proofFile);

      if (proofStats.isFile()) {
        completed.push({
          missionId: entry.name,
          directory,
          completedAt: proofStats.mtimeMs,
        });
      }
    } catch (error) {
      if (!missing(error)) {
        throw error;
      }

      const directoryStats = await stat(directory);

      if (now - directoryStats.mtimeMs > staleMs) {
        staleIncomplete.push({
          missionId: entry.name,
          directory,
        });
      }
    }
  }

  /*
   * proof.json is written last, so its modification
   * time is a good approximation of mission completion.
   */
  completed.sort((a, b) => b.completedAt - a.completedAt);

  const oldCompleted = completed.slice(maxSavedMissions);

  for (const mission of oldCompleted) {
    await rm(mission.directory, {
      recursive: true,
      force: true,
    });
  }

  /*
   * Remove abandoned/partial mission directories.
   *
   * Active missions finish within minutes, so a
   * web mission without proof.json after 24 hours
   * is stale.
   */
  for (const mission of staleIncomplete) {
    await rm(mission.directory, {
      recursive: true,
      force: true,
    });
  }

  /*
   * Live status files are only needed while a mission
   * is running/recently completed.
   */
  const runsDirectory = path.join(outputRoot, ".runs");

  let runEntries;

  try {
    runEntries = await readdir(runsDirectory, {
      withFileTypes: true,
    });
  } catch (error) {
    if (missing(error)) {
      return;
    }

    throw error;
  }

  for (const entry of runEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const missionId = entry.name.slice(0, -".json".length);

    if (!WEB_MISSION_ID.test(missionId)) {
      continue;
    }

    const filename = path.join(runsDirectory, entry.name);

    const fileStats = await stat(filename);

    if (now - fileStats.mtimeMs > staleMs) {
      await unlink(filename).catch((error: unknown) => {
        if (!missing(error)) {
          throw error;
        }
      });
    }
  }
}
