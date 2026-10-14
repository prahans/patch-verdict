import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }

    return nextResolve(
      specifier.startsWith(".") && !path.extname(specifier)
        ? specifier + ".ts"
        : specifier,
      context,
    );
  },
});

const {
  cleanupMissionOutput,
  MAX_SAVED_WEB_MISSIONS,
  STALE_WEB_ARTIFACT_MS,
} = await import("../lib/mission-retention.ts");

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
let fixtureRoot;

function missionId(index) {
  return `web-00000000-0000-0000-0000-${index
    .toString(16)
    .padStart(12, "0")}`;
}

function missing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

async function exists(filename) {
  try {
    await stat(filename);
    return true;
  } catch (error) {
    if (missing(error)) return false;
    throw error;
  }
}

async function setModifiedTime(filename, timeMs) {
  const date = new Date(timeMs);
  await utimes(filename, date, date);
}

async function createCompletedMission(id, completedAt) {
  const directory = path.join(fixtureRoot, "output", id);
  const proof = path.join(directory, "proof.json");
  await mkdir(directory, { recursive: true });
  await writeFile(proof, JSON.stringify({ mission: { id } }));
  await setModifiedTime(proof, completedAt);
}

async function createIncompleteMission(id, modifiedAt) {
  const directory = path.join(fixtureRoot, "output", id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "events.json"), "[]");
  await setModifiedTime(directory, modifiedAt);
}

async function createRunStatus(id, modifiedAt) {
  const runsDirectory = path.join(fixtureRoot, "output", ".runs");
  const filename = path.join(runsDirectory, `${id}.json`);
  await mkdir(runsDirectory, { recursive: true });
  await writeFile(filename, "{}");
  await setModifiedTime(filename, modifiedAt);
  return filename;
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(testsDirectory, ".mission-retention-"));

  await Promise.all([
    mkdir(path.join(fixtureRoot, "apps", "web"), { recursive: true }),
    mkdir(path.join(fixtureRoot, "src"), { recursive: true }),
  ]);

  await Promise.all([
    writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "patch-verdict" }),
    ),
    writeFile(
      path.join(fixtureRoot, "src", "real-mission-demo.ts"),
      "// fixed repository-root marker",
    ),
  ]);

  process.chdir(path.join(fixtureRoot, "apps", "web"));
});

afterEach(async () => {
  process.chdir(originalCwd);

  assert.equal(path.dirname(path.resolve(fixtureRoot)), testsDirectory);
  assert.ok(path.basename(fixtureRoot).startsWith(".mission-retention-"));

  await rm(fixtureRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

test("keeps the newest 20 completed web proof bundles and deletes older ones", async () => {
  const now = Date.parse("2026-10-13T02:00:00.000Z");
  const total = MAX_SAVED_WEB_MISSIONS + 2;

  for (let index = 0; index < total; index++) {
    await createCompletedMission(
      missionId(index),
      now - index * 60_000,
    );
  }

  await cleanupMissionOutput({ now });

  const entries = await readdir(path.join(fixtureRoot, "output"), {
    withFileTypes: true,
  });

  const savedWebMissions = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("web-"))
    .map((entry) => entry.name)
    .sort();

  assert.equal(savedWebMissions.length, MAX_SAVED_WEB_MISSIONS);

  for (let index = 0; index < MAX_SAVED_WEB_MISSIONS; index++) {
    assert.equal(
      await exists(path.join(fixtureRoot, "output", missionId(index))),
      true,
      `expected newest mission ${index} to be retained`,
    );
  }

  for (let index = MAX_SAVED_WEB_MISSIONS; index < total; index++) {
    assert.equal(
      await exists(path.join(fixtureRoot, "output", missionId(index))),
      false,
      `expected old mission ${index} to be deleted`,
    );
  }
});

test("removes stale incomplete web missions and run-status files but keeps fresh active ones", async () => {
  const now = Date.parse("2026-10-13T02:00:00.000Z");
  const staleTime = now - STALE_WEB_ARTIFACT_MS - 60_000;
  const freshTime = now - 60 * 60 * 1000;

  const staleMission = missionId(100);
  const freshMission = missionId(101);
  const staleRun = missionId(102);
  const freshRun = missionId(103);

  await createIncompleteMission(staleMission, staleTime);
  await createIncompleteMission(freshMission, freshTime);

  const staleRunFile = await createRunStatus(staleRun, staleTime);
  const freshRunFile = await createRunStatus(freshRun, freshTime);

  await cleanupMissionOutput({ now });

  assert.equal(
    await exists(path.join(fixtureRoot, "output", staleMission)),
    false,
  );
  assert.equal(
    await exists(path.join(fixtureRoot, "output", freshMission)),
    true,
  );
  assert.equal(await exists(staleRunFile), false);
  assert.equal(await exists(freshRunFile), true);
});

test("PR publication metadata follows its proof bundle's existing retention lifetime", async () => {
  const now = Date.parse("2026-10-13T02:00:00.000Z");
  const retained = missionId(200);
  const expired = missionId(201);
  for (const [id, age] of [[retained, 0], [expired, 60_000]]) {
    await createCompletedMission(id, now - age);
    await writeFile(
      path.join(fixtureRoot, "output", id, "pull-request.json"),
      JSON.stringify({ number: 12, url: "https://github.com/owner/repo/pull/12" }),
    );
  }
  await cleanupMissionOutput({ now, maxSavedMissions: 1 });
  assert.equal(await exists(path.join(fixtureRoot, "output", retained, "pull-request.json")), true);
  assert.equal(await exists(path.join(fixtureRoot, "output", expired, "pull-request.json")), false);
});

test("never deletes manual, benchmark, or non-web output artifacts", async () => {
  const now = Date.parse("2026-10-13T02:00:00.000Z");
  const staleTime = now - STALE_WEB_ARTIFACT_MS * 2;

  const protectedDirectories = [
    "real-demo",
    "benchmark-example",
    "web-not-a-uuid",
  ];

  for (const name of protectedDirectories) {
    const directory = path.join(fixtureRoot, "output", name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "proof.json"), "{}");
    await setModifiedTime(directory, staleTime);
  }

  const manualRun = await createRunStatus("real-demo", staleTime);
  const nonUuidRun = await createRunStatus("web-not-a-uuid", staleTime);

  await cleanupMissionOutput({ now });

  for (const name of protectedDirectories) {
    assert.equal(
      await exists(path.join(fixtureRoot, "output", name)),
      true,
      `expected ${name} to remain untouched`,
    );
  }

  assert.equal(await exists(manualRun), true);
  assert.equal(await exists(nonUuidRun), true);
});
