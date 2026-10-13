import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

globalThis.missionAfterCallbacks = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    if (specifier === "next/server") {
      return {
        url: "data:text/javascript,export function after(callback) { globalThis.missionAfterCallbacks.push(callback); }",
        shortCircuit: true,
      };
    }
    return nextResolve(
      specifier.startsWith(".") && !path.extname(specifier)
        ? specifier + ".ts"
        : specifier,
      context,
    );
  },
});

const { runBackendMission } = await import("../lib/run-backend-mission.ts");
const { parseMissionInput, MISSION_INPUT_LIMITS } =
  await import("../lib/mission-input.ts");
const { resolveRepositoryRoot } = await import("../lib/repository-root.ts");
const {
  createMissionLiveStatus,
  readMissionLiveStatus,
  recordMissionLiveEvent,
  failMissionLiveStatus,
  completeMissionLiveStatus,
  proofBundleExists,
} = await import("../lib/mission-live-status.ts");
const { POST, runtime, maxDuration } =
  await import("../app/api/missions/route.ts");
const { GET } = await import("../app/api/missions/[missionId]/status/route.ts");
const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
let fixtureRoot;
let completions;

const validInput = {
  repositoryUrl: "https://github.com/owner/repository",
  issue: "The average calculation returns an incorrect result.",
  reproductionCommand: "npm test",
  requiredOutput: "expected",
};

// Disposable process contract fixture: no network, provider, shell, or AI mocks
// are involved in the separate real sandbox benchmark.
const cli = String.raw`
import { mkdir, writeFile, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
const [script, repositoryUrl, issue, suppliedCommand, requiredOutput] = process.argv.slice(2);
const id = process.env.PATCHVERDICT_MISSION_ID;
const command = suppliedCommand || "npm test";
await writeFile("received.json", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), id, inherited: process.env.PATCHVERDICT_BRIDGE_TEST_VALUE }));
if (issue.startsWith("crash:")) { console.error("SECRET_CREDENTIAL_DO_NOT_RETURN /private/server/path"); process.exit(7); }
if (issue.startsWith("timeout:")) {
  const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });
  await writeFile("pids.json", JSON.stringify([process.pid, descendant.pid]));
  setInterval(() => {}, 1000);
} else {
  console.log("[COMPLETED] Mission completed with verdict VERIFIED");
  console.log("PATCHVERDICT EVENT wrong-id: [INVESTIGATING] AI investigation completed");
  console.log("[INVESTIGATING] AI investigation completed");
  console.log("PATCHVERDICT EVENT " + id + ": [PREPARING] Preparing repository...");
  process.stdout.write("PATCHVERDICT EVENT " + id + ": [BASE");
  await new Promise((resolve) => setTimeout(resolve, 15));
  process.stdout.write("LINE] Running reproduction test before patch\r\n");
  console.log("PATCHVERDICT EVENT " + id + ": [BASELINE] Reported bug reproduced");
  console.log("PATCHVERDICT EVENT " + id + ": [VERIFYING] SECRET_CREDENTIAL_DO_NOT_RETURN");
  console.log("x".repeat(100000) + "[COMPLETED] Mission completed with verdict VERIFIED");
  process.stderr.write("e".repeat(100000));
  if (issue.startsWith("gate:"))  {
    await writeFile("ready", "yes");
    while (true) {
      try { await access("release"); break; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  console.log("PATCHVERDICT EVENT " + id + ": [FAILED] SECRET_CREDENTIAL_DO_NOT_RETURN /private/server/path");
  console.log("[COMPLETED] Mission completed with verdict VERIFIED");
  console.log("PATCHVERDICT RUN START: " + id);
  process.stdout.write("[INVESTIGATING] AI investigation completed");
  if (!issue.startsWith("missing-bundle:")) {
    const directory = path.join("output", id);
    await mkdir(directory, { recursive: true });
    const proof = { version: 2, mission: { id, issue, source: { repositoryUrl, baseCommit: "a".repeat(40) }, reproduction: { label: "Reproduction", command }, fullSuite: { label: "Suite", command } }, status: "FAILED", verdict: "FAILED", artifacts: null };
    if (issue.startsWith("foreign-proof:")) proof.mission.source.repositoryUrl = "https://github.com/other/repository";
    if (issue.startsWith("different-issue:")) proof.mission.issue = "unrelated bug";
    await writeFile(path.join(directory, "proof.json"), issue.startsWith("bad-bundle:") ? "{broken" : JSON.stringify(proof));
    await writeFile(path.join(directory, "events.json"), "[]");
  }
  process.exitCode = 9;
}
`;

beforeEach(async () => {
  completions = [];
  globalThis.missionAfterCallbacks = [];
  fixtureRoot = await mkdtemp(path.join(testsDirectory, ".mission-bridge-"));
  await Promise.all([
    mkdir(path.join(fixtureRoot, "apps", "web"), { recursive: true }),
    mkdir(path.join(fixtureRoot, "src")),
    mkdir(path.join(fixtureRoot, "node_modules", "tsx", "dist"), {
      recursive: true,
    }),
  ]);
  await Promise.all([
    writeFile(
      path.join(fixtureRoot, "package.json"),
      JSON.stringify({ name: "patch-verdict" }),
    ),
    writeFile(
      path.join(fixtureRoot, "src", "real-mission-demo.ts"),
      "// fixed entry point",
    ),
    writeFile(
      path.join(fixtureRoot, "node_modules", "tsx", "dist", "cli.mjs"),
      cli,
    ),
  ]);
  process.chdir(path.join(fixtureRoot, "apps", "web"));
});

afterEach(async () => {
  await writeFile(path.join(fixtureRoot, "release"), "yes");
  await Promise.all([
    ...completions,
    ...globalThis.missionAfterCallbacks.map((callback) => callback()),
  ]);
  process.chdir(originalCwd);
  delete process.env.PATCHVERDICT_BRIDGE_TEST_VALUE;
  // Verify the resolved target before recursively deleting this disposable fixture.
  assert.equal(path.dirname(path.resolve(fixtureRoot)), testsDirectory);
  assert.ok(path.basename(fixtureRoot).startsWith(".mission-bridge-"));
  await rm(fixtureRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

async function launch(input = validInput, options) {
  const run = await runBackendMission(input, options);
  completions.push(run.completion);
  return run;
}

function request(body, headers = { "Content-Type": "application/json" }) {
  return new Request("http://localhost/api/missions", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function statusRequest(missionId) {
  return GET(new Request("http://localhost/api/missions/status"), {
    params: Promise.resolve({ missionId }),
  });
}

async function until(check) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("Expected process fixture condition before timeout");
}

async function saveProof(id, input = validInput, contents) {
  const directory = path.join(fixtureRoot, "output", id);
  await mkdir(directory, { recursive: true });
  const proof = {
    version: 2,
    mission: {
      id,
      issue: input.issue,
      source: {
        repositoryUrl: input.repositoryUrl,
        baseCommit: "a".repeat(40),
      },
      reproduction: { label: "Reproduction", command: "npm test" },
      fullSuite: { label: "Suite", command: "npm test" },
    },
    status: "FAILED",
    verdict: "FAILED",
    artifacts: null,
  };
  await writeFile(
    path.join(directory, "proof.json"),
    contents ?? JSON.stringify(proof),
  );
  await writeFile(path.join(directory, "events.json"), "[]");
}

test("validation requires only repository and issue; omitted advanced fields normalize to empty strings", () => {
  assert.deepEqual(
    parseMissionInput({
      repositoryUrl: " HTTPS://GITHUB.COM/owner/repository/ ",
      issue: " average calculation returns an incorrect result ",
    }),
    {
      repositoryUrl: validInput.repositoryUrl,
      issue: "average calculation returns an incorrect result",
      reproductionCommand: "",
      requiredOutput: "",
    },
  );
  assert.deepEqual(
    parseMissionInput({
      ...validInput,
      reproductionCommand: "  ",
      requiredOutput: " marker ",
    }),
    {
      ...validInput,
      reproductionCommand: "",
      requiredOutput: "marker",
    },
  );
});

test("validation rejects unsafe repositories, types, required fields, NUL and oversized fields", () => {
  for (const repositoryUrl of [
    "https://example.com/owner/repo",
    "http://github.com/owner/repo",
    "https://github.com.evil/owner/repo",
    "https://user:token@github.com/owner/repo",
    "https://github.com:444/owner/repo",
    "https://github.com/owner/repo?token=secret",
    "https://github.com/owner/repo#fragment",
    "https://github.com/owner/repo/tree/main",
    "https://github.com",
    "not a URL",
  ])
    assert.throws(() => parseMissionInput({ ...validInput, repositoryUrl }));
  for (const invalid of [null, [], 42, "text"])
    assert.throws(() => parseMissionInput(invalid));
  for (const [field, limit] of Object.entries(MISSION_INPUT_LIMITS)) {
    assert.throws(() =>
      parseMissionInput({ ...validInput, [field]: "x".repeat(limit + 1) }),
    );
    assert.throws(() => parseMissionInput({ ...validInput, [field]: 42 }));
    assert.throws(() =>
      parseMissionInput({ ...validInput, [field]: "has\0nul" }),
    );
    if (["repositoryUrl", "issue"].includes(field))
      assert.throws(() => parseMissionInput({ ...validInput, [field]: "  " }));
  }
});

test("resolves the checkout from root, apps/web and nested app directories", async () => {
  assert.equal(await resolveRepositoryRoot(), fixtureRoot);
  assert.equal(await resolveRepositoryRoot(fixtureRoot), fixtureRoot);
  const nested = path.join(fixtureRoot, "apps", "web", ".next");
  await mkdir(nested);
  assert.equal(await resolveRepositoryRoot(nested), fixtureRoot);
});

test("launch returns before completion, with initial durable status and unique IDs", async () => {
  const first = await launch({
    ...validInput,
    issue: "gate: keep the backend running until the test releases it",
  });
  assert.match(first.missionId, /^web-[0-9a-f-]{36}$/);
  let completed = false;
  first.completion.then(() => {
    completed = true;
  });
  const initial = await readMissionLiveStatus(first.missionId);
  assert.ok(["QUEUED", "RUNNING"].includes(initial.status));
  assert.equal(initial.proofReady, false);
  assert.equal(
    initial.issue,
    "gate: keep the backend running until the test releases it",
  );
  await until(async () => {
    try {
      return await readFile(path.join(fixtureRoot, "ready"), "utf8");
    } catch {
      return false;
    }
  });
  assert.equal(completed, false);
  const second = await launch();
  assert.notEqual(second.missionId, first.missionId);
  await second.completion;
  await writeFile(path.join(fixtureRoot, "release"), "yes");
  await first.completion;
  assert.equal((await readMissionLiveStatus(first.missionId)).proofReady, true);
});

test("fixed CLI arguments remain literal, environment is inherited, and server ID is authoritative", async () => {
  process.env.PATCHVERDICT_BRIDGE_TEST_VALUE = "inherited-test-value";
  const input = {
    ...validInput,
    issue: 'quotes " and newline\nremain data',
    reproductionCommand: 'npm test && echo $(whoami); & | "literal"',
    requiredOutput: 'expected "quotes"',
  };
  const run = await launch(input);
  await run.completion;
  const received = JSON.parse(
    await readFile(path.join(fixtureRoot, "received.json"), "utf8"),
  );
  assert.deepEqual(received.args, [
    path.join(fixtureRoot, "src", "real-mission-demo.ts"),
    ...Object.values(input),
  ]);
  assert.equal(received.cwd, fixtureRoot);
  assert.equal(received.inherited, "inherited-test-value");
  assert.equal(received.id, run.missionId);
  const status = await readMissionLiveStatus(run.missionId);
  assert.equal(status.status, "COMPLETED");
  assert.equal(status.proofReady, true); // FAILED verdict plus nonzero CLI exit still has usable proof.
});

test("omitted reproduction keeps its positional slot before the optional failure marker", async () => {
  const run = await launch({
    repositoryUrl: validInput.repositoryUrl,
    issue: validInput.issue,
    requiredOutput: "marker",
  });
  await run.completion;
  const received = JSON.parse(
    await readFile(path.join(fixtureRoot, "received.json"), "utf8"),
  );
  assert.deepEqual(received.args.slice(1), [
    validInput.repositoryUrl,
    validInput.issue,
    "",
    "marker",
  ]);
  assert.equal((await readMissionLiveStatus(run.missionId)).proofReady, true);
});

test("only allowlisted events bearing the server mission ID are persisted in stdout order", async () => {
  const run = await launch();
  await run.completion;
  const status = await readMissionLiveStatus(run.missionId);
  assert.deepEqual(
    status.events.map(({ state, message }) => ({ state, message })),
    [
      { state: "PREPARING", message: "Backend process started." },
      { state: "PREPARING", message: "Preparing repository..." },
      { state: "BASELINE", message: "Running reproduction test before patch" },
      { state: "BASELINE", message: "Reported bug reproduced" },
      {
        state: "FAILED",
        message: "The backend reported a failure. Recording available proof.",
      },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(status),
    /SECRET_CREDENTIAL|private|AI investigation completed|VERIFIED/,
  );
});

test("crash and missing proof persist a safe execution failure after successful launch", async () => {
  for (const issue of [
    "crash: simulate the backend crashing after mission startup",
    "missing-bundle: simulate completion without a saved proof bundle",
  ]) {
    const run = await launch({ ...validInput, issue });
    await run.completion;
    const status = await readMissionLiveStatus(run.missionId);
    assert.equal(status.status, "FAILED");
    assert.equal(status.proofReady, false);
    assert.match(status.error, /readable proof bundle/);
    assert.doesNotMatch(
      JSON.stringify(status),
      /SECRET_CREDENTIAL|private|cli.mjs/,
    );
  }
});

test("malformed or unrelated proof cannot mark execution completed; proof presence permits canonical artifact handling", async () => {
  for (const issue of [
    "bad-bundle: simulate malformed proof bundle metadata",
    "foreign-proof: simulate proof belonging to another repository",
    "different-issue: simulate proof belonging to another bug report",
  ]) {
    const run = await launch({ ...validInput, issue });
    await run.completion;
    const status = await readMissionLiveStatus(run.missionId);
    assert.equal(status.status, "FAILED");
    assert.equal(status.proofReady, true);
    assert.equal(await completeMissionLiveStatus(run.missionId), false);
  }
});

test("timeout kills the CLI and descendant, then persists a safe failure", async () => {
  const run = await launch(
    {
      ...validInput,
      issue: "timeout: simulate a backend process exceeding the time limit",
    },
    { timeoutMs: 1000 },
  );
  await run.completion;
  const status = await readMissionLiveStatus(run.missionId);
  assert.equal(status.status, "FAILED");
  assert.equal(status.proofReady, false);
  assert.match(status.error, /time limit/);
  const pids = JSON.parse(
    await readFile(path.join(fixtureRoot, "pids.json"), "utf8"),
  );
  await until(() =>
    pids.every((pid) => {
      try {
        process.kill(pid, 0);
        return false;
      } catch (error) {
        return error.code === "ESRCH";
      }
    }),
  );
});

test("API enforces JSON, bounded bodies, validation and Node runtime", async () => {
  assert.equal(runtime, "nodejs");
  assert.equal(maxDuration, 300);
  for (const [req, status] of [
    [request("{}", { "Content-Type": "text/plain" }), 415],
    [request("{broken"), 400],
    [request({ ...validInput, repositoryUrl: "https://example.com/a/b" }), 400],
    [request({ ...validInput, issue: " " }), 400],
    [request("x".repeat(65537)), 413],
    [
      request("{}", {
        "Content-Type": "application/json",
        "Content-Length": "65537",
      }),
      413,
    ],
  ]) {
    const response = await POST(req);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  }
  assert.equal(globalThis.missionAfterCallbacks.length, 0);
});

test("API returns 202 plus mission/status URLs before completion and retains completion with after", async () => {
  const response = await POST(
    request({
      repositoryUrl: validInput.repositoryUrl,
      issue: "gate: keep the backend running until the test releases it",
    }),
  );
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.match(body.missionId, /^web-[0-9a-f-]{36}$/);
  assert.deepEqual(body, {
    missionId: body.missionId,
    missionUrl: `/missions/${body.missionId}`,
    statusUrl: `/api/missions/${body.missionId}/status`,
  });
  assert.equal(globalThis.missionAfterCallbacks.length, 1);
  const runningResponse = await statusRequest(body.missionId);
  assert.equal(runningResponse.status, 200);
  assert.equal(runningResponse.headers.get("Cache-Control"), "no-store");
  assert.equal((await runningResponse.json()).proofReady, false);
  await writeFile(path.join(fixtureRoot, "release"), "yes");
  await globalThis.missionAfterCallbacks[0]();
  assert.equal(
    (await (await statusRequest(body.missionId)).json()).proofReady,
    true,
  );
});

test("API accepts a launch that later crashes, then exposes only safe persisted failure", async () => {
  const response = await POST(
    request({
      ...validInput,
      issue: "crash: simulate the backend crashing after mission startup",
    }),
  );
  assert.equal(response.status, 202);
  const body = await response.json();
  await globalThis.missionAfterCallbacks[0]();
  const status = await (await statusRequest(body.missionId)).json();
  assert.equal(status.status, "FAILED");
  assert.doesNotMatch(
    JSON.stringify(status),
    /SECRET_CREDENTIAL|private|cli.mjs/,
  );
});

test("missing backend dependencies return service unavailable before accepting a mission", async () => {
  await rm(path.join(fixtureRoot, "node_modules", "tsx", "dist", "cli.mjs"));
  const response = await POST(request(validInput));
  assert.equal(response.status, 503);
  assert.match(
    (await response.json()).error,
    /Install the backend dependencies/,
  );
  assert.equal(globalThis.missionAfterCallbacks.length, 0);
});

test("persisted transitions survive fresh reads, terminal failure ignores late events, and atomic writes leave no temp files", async () => {
  const id = "web-status-test";
  await createMissionLiveStatus(id, validInput, 10000);
  const queued = await readMissionLiveStatus(id);
  assert.equal(queued.status, "QUEUED");
  assert.deepEqual(queued.events, []);
  await recordMissionLiveEvent(id, {
    state: "BASELINE",
    message: "Running reproduction test before patch",
  });
  await recordMissionLiveEvent(id, {
    state: "BASELINE",
    message: "Reported bug reproduced",
  });
  const running = await readMissionLiveStatus(id);
  assert.equal(running.status, "RUNNING");
  assert.equal(running.phase, "BASELINE");
  assert.equal(running.events.length, 2);
  const failure = await failMissionLiveStatus(id, "Execution failed safely.");
  await recordMissionLiveEvent(id, {
    state: "COMPLETED",
    message: "Mission completed with verdict VERIFIED",
  });
  assert.deepEqual(await readMissionLiveStatus(id), failure);
  assert.deepEqual(await readdir(path.join(fixtureRoot, "output", ".runs")), [
    `${id}.json`,
  ]);
});

test("proof presence immediately triggers readiness without interrupting durable event recording", async () => {
  const id = "web-proof-ready";
  await createMissionLiveStatus(id, validInput, 10000);
  assert.equal(await proofBundleExists(id), false);
  await saveProof(id);
  assert.equal(await proofBundleExists(id), true);
  const proofPresent = await readMissionLiveStatus(id);
  assert.equal(proofPresent.proofReady, true);
  assert.equal(proofPresent.status, "QUEUED");
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(fixtureRoot, "output", ".runs", `${id}.json`),
        "utf8",
      ),
    ).proofReady,
    false,
  );
  await recordMissionLiveEvent(id, {
    state: "COMPLETED",
    message: "Mission completed with verdict FAILED",
  });
  assert.equal(await completeMissionLiveStatus(id), true);
  const status = await readMissionLiveStatus(id);
  assert.equal(status.proofReady, true);
  assert.equal(status.status, "COMPLETED");
  assert.equal(status.events.length, 1);
});

test("corrupt proof presence hands control to the canonical artifact error without claiming completion", async () => {
  const id = "web-corrupt-proof";
  await createMissionLiveStatus(id, validInput, 10000);
  await saveProof(id, validInput, "{broken");
  const status = await readMissionLiveStatus(id);
  assert.equal(status.proofReady, true);
  assert.equal(status.status, "QUEUED");
  assert.equal(await completeMissionLiveStatus(id), false);
});

test("missing proof is reflected on the next read even after a completed status was saved", async () => {
  const id = "web-proof-removed";
  await createMissionLiveStatus(id, validInput, 10000);
  await saveProof(id);
  assert.equal(await completeMissionLiveStatus(id), true);
  await rm(path.join(fixtureRoot, "output", id, "proof.json"));
  assert.equal((await readMissionLiveStatus(id)).proofReady, false);
});

test("an abandoned persisted run fails after deadline and remains failed on subsequent reads", async () => {
  const id = "web-abandoned";
  await createMissionLiveStatus(id, validInput, -6000);
  const status = await readMissionLiveStatus(id);
  assert.equal(status.status, "FAILED");
  assert.match(status.error, /server stopped/);
  assert.equal(status.events.length, 1);
  assert.deepEqual(await readMissionLiveStatus(id), status);
});

test("disk remains authoritative and status API rejects malformed, unknown, and unsafe mission IDs", async () => {
  assert.equal((await statusRequest("web-unknown")).status, 404);
  for (const id of ["../private", "a/b", "a\\b", "%2e%2e", "", ".runs"]) {
    const response = await statusRequest(id);
    assert.equal(response.status, 400);
    await assert.rejects(readMissionLiveStatus(id), /Invalid mission ID/);
    await assert.rejects(
      createMissionLiveStatus(id, validInput, 10000),
      /Invalid mission ID/,
    );
    await assert.rejects(proofBundleExists(id), /Invalid mission ID/);
  }
  const id = "web-corrupt";
  await createMissionLiveStatus(id, validInput, 10000);
  const filename = path.join(fixtureRoot, "output", ".runs", `${id}.json`);
  const persisted = JSON.parse(await readFile(filename, "utf8"));
  persisted.issue = "Restored from disk";
  await writeFile(filename, JSON.stringify(persisted));
  assert.equal((await readMissionLiveStatus(id)).issue, "Restored from disk");
  await writeFile(filename, "SECRET_CREDENTIAL_DO_NOT_RETURN");
  const response = await statusRequest(id);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "Mission status could not be read.",
  });
});

test("status storage rejects a .runs junction that resolves outside output", async (context) => {
  const outside = path.join(fixtureRoot, "outside-runs");
  const output = path.join(fixtureRoot, "output");
  await Promise.all([mkdir(outside), mkdir(output)]);
  try {
    await symlink(
      outside,
      path.join(output, ".runs"),
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code))
      return context.skip("Filesystem does not permit test symlinks");
    throw error;
  }
  await assert.rejects(
    createMissionLiveStatus("web-escape", validInput, 10000),
    /outside the allowed directory/,
  );
  assert.deepEqual(await readdir(outside), []);
});
