import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: "data:text/javascript,export {};", shortCircuit: true };
    }
    return nextResolve(specifier.startsWith(".") && !path.extname(specifier) ? specifier + ".ts" : specifier, context);
  },
});

const { runBackendMission } = await import("../lib/run-backend-mission.ts");
const { parseMissionInput, MISSION_INPUT_LIMITS } = await import("../lib/mission-input.ts");
const { resolveRepositoryRoot } = await import("../lib/repository-root.ts");
const { POST, runtime, maxDuration } = await import("../app/api/missions/route.ts");
const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
const missionId = "real-test-mission";
let fixtureRoot;

const validInput = {
  repositoryUrl: "https://github.com/owner/repository",
  issue: "Bug report",
  reproductionCommand: "npm test",
  requiredOutput: "expected",
};

// A disposable local executable exercises the real spawn boundary. These are
// process contract tests, not a substitute for the live sandbox mission test.
const cli = [
  'import { mkdir, writeFile, utimes } from "node:fs/promises";',
  'import { spawn } from "node:child_process";',
  'import path from "node:path";',
  'const [script, repositoryUrl, issue, command, requiredOutput] = process.argv.slice(2);',
  'await writeFile("received.json", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), inherited: process.env.PATCHVERDICT_BRIDGE_TEST_VALUE }));',
  'if (issue === "crash") { console.error("SECRET_CREDENTIAL_DO_NOT_RETURN /private/server/path"); process.exit(7); }',
  'if (issue === "timeout") {',
  '  const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });',
  '  await writeFile("pids.json", JSON.stringify([process.pid, descendant.pid]));',
  '  setInterval(() => {}, 1000);',
  '} else {',
  '  const id = "real-test-mission";',
  '  if (issue !== "missing-bundle") {',
  '    const directory = path.join("output", id);',
  '    await mkdir(directory, { recursive: true });',
  '    const proof = { version: 2, mission: { id, issue, source: { repositoryUrl, baseCommit: "a".repeat(40) }, reproduction: { label: "Reproduction", command }, fullSuite: { label: "Suite", command } }, status: "FAILED", verdict: "FAILED", artifacts: null };',
  '    if (issue === "foreign-proof") proof.mission.source.repositoryUrl = "https://github.com/other/repository";',
  '    if (issue === "different-issue") proof.mission.issue = "unrelated bug";',
  '    await writeFile(path.join(directory, "proof.json"), issue === "bad-bundle" ? "{broken" : JSON.stringify(proof));',
  '    await writeFile(path.join(directory, "events.json"), "[]");',
  '    if (issue === "stale-proof") await utimes(path.join(directory, "proof.json"), new Date(0), new Date(0));',
  '  }',
  '  if (issue === "unsafe-id") console.log("Mission ID: ../../private");',
  '  else {',
  '    process.stdout.write("x".repeat(100000) + "\n");',
  '    process.stderr.write("e".repeat(100000) + "\n");',
  '    console.log("Mission ID: spoof-before");',
  '    process.stdout.write("Mission I");',
  '    await new Promise((resolve) => setTimeout(resolve, 30));',
  '    process.stdout.write("D: " + id + (issue === "no-newline" ? "" : "\r\n"));',
  '    if (issue !== "no-newline") console.log("Execution: FAILED\nVerdict: FAILED\n" + "x".repeat(100000));',
  '  }',
  '  if (issue !== "no-newline") console.log("Mission ID: spoof-after");',
  '  process.exitCode = 9;',
  '}',
].map((line) => line.replaceAll("\r", "\\r").replaceAll("\n", "\\n")).join("\n");

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(testsDirectory, ".mission-bridge-"));
  await Promise.all([
    mkdir(path.join(fixtureRoot, "apps", "web"), { recursive: true }),
    mkdir(path.join(fixtureRoot, "src")),
    mkdir(path.join(fixtureRoot, "node_modules", "tsx", "dist"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "patch-verdict" })),
    writeFile(path.join(fixtureRoot, "src", "real-mission-demo.ts"), "// fixed entry point"),
    writeFile(path.join(fixtureRoot, "node_modules", "tsx", "dist", "cli.mjs"), cli),
  ]);
  process.chdir(path.join(fixtureRoot, "apps", "web"));
});

afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.PATCHVERDICT_BRIDGE_TEST_VALUE;
  // Only this test's verified, direct-child disposable fixture is removed.
  assert.equal(path.dirname(path.resolve(fixtureRoot)), testsDirectory);
  assert.ok(path.basename(fixtureRoot).startsWith(".mission-bridge-"));
  await rm(fixtureRoot, { recursive: true, force: true });
});

function request(body, headers = { "Content-Type": "application/json" }) {
  return new Request("http://localhost/api/missions", {
    method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("validation trims fields, normalizes GitHub URL and accepts omitted marker", () => {
  assert.deepEqual(parseMissionInput({
    repositoryUrl: " HTTPS://GITHUB.COM/owner/repository/ ", issue: " bug ", reproductionCommand: " npm test ",
  }), { repositoryUrl: validInput.repositoryUrl, issue: "bug", reproductionCommand: "npm test", requiredOutput: "" });
});

test("validation rejects unsafe repositories, types, required fields, NUL and oversized fields", () => {
  for (const repositoryUrl of [
    "https://example.com/owner/repo", "http://github.com/owner/repo", "https://github.com.evil/owner/repo",
    "https://user:token@github.com/owner/repo", "https://github.com:444/owner/repo",
    "https://github.com/owner/repo?token=secret", "https://github.com/owner/repo#fragment",
    "https://github.com/owner/repo/tree/main", "https://github.com", "not a URL",
  ]) {
    assert.throws(() => parseMissionInput({ ...validInput, repositoryUrl }));
  }
  for (const invalid of [null, [], 42, "text"]) assert.throws(() => parseMissionInput(invalid));
  for (const [field, limit] of Object.entries(MISSION_INPUT_LIMITS)) {
    assert.throws(() => parseMissionInput({ ...validInput, [field]: "x".repeat(limit + 1) }));
    assert.throws(() => parseMissionInput({ ...validInput, [field]: 42 }));
    assert.throws(() => parseMissionInput({ ...validInput, [field]: "has\0nul" }));
    if (field !== "requiredOutput") assert.throws(() => parseMissionInput({ ...validInput, [field]: "  " }));
  }
});

test("resolves one checkout from root, apps/web and nested app directories", async () => {
  const expected = await resolveRepositoryRoot();
  assert.equal(expected, fixtureRoot);
  assert.equal(await resolveRepositoryRoot(fixtureRoot), expected);
  await mkdir(path.join(fixtureRoot, "apps", "web", ".next"));
  assert.equal(await resolveRepositoryRoot(path.join(fixtureRoot, "apps", "web", ".next")), expected);
});

test("launches fixed CLI arguments literally, inherits environment, and accepts FAILED proof after nonzero exit", async () => {
  process.env.PATCHVERDICT_BRIDGE_TEST_VALUE = "inherited-test-value";
  const input = {
    ...validInput,
    issue: 'quotes " and newline\nremain data',
    reproductionCommand: 'npm test && echo $(whoami); & | "literal"',
    requiredOutput: 'expected "quotes"',
  };
  assert.deepEqual(await runBackendMission(input), { missionId });
  const received = JSON.parse(await readFile(path.join(fixtureRoot, "received.json"), "utf8"));
  assert.deepEqual(received.args, [path.join(fixtureRoot, "src", "real-mission-demo.ts"), ...Object.values(input)]);
  assert.equal(received.cwd, fixtureRoot);
  assert.equal(received.inherited, "inherited-test-value");
});

test("keeps a valid final Mission ID without a newline", async () => {
  assert.deepEqual(await runBackendMission({ ...validInput, issue: "no-newline" }), { missionId });
});

test("rejects crashes and unsafe IDs without exposing child output", async () => {
  for (const issue of ["crash"]) {
    await assert.rejects(runBackendMission({ ...validInput, issue }), (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /before producing a mission ID/);
      assert.doesNotMatch(error.message, /SECRET_CREDENTIAL|private|cli.mjs/);
      return true;
    });
  }
});

test("rejects unsafe IDs and missing, malformed, stale, or unrelated proof artifacts", async () => {
  for (const issue of ["missing-bundle", "bad-bundle", "unsafe-id", "foreign-proof", "different-issue", "stale-proof"]) {
    await assert.rejects(runBackendMission({ ...validInput, issue }), /readable proof bundle/);
  }
});

test("timeout stops the CLI and its descendant and returns a safe 504 error", async () => {
  await assert.rejects(runBackendMission({ ...validInput, issue: "timeout" }, { timeoutMs: 1000 }), (error) => {
    assert.equal(error.status, 504);
    assert.match(error.message, /time limit/);
    return true;
  });
  const pids = JSON.parse(await readFile(path.join(fixtureRoot, "pids.json"), "utf8"));
  for (const pid of pids) {
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  }
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
    [request("{}", { "Content-Type": "application/json", "Content-Length": "65537" }), 413],
  ]) {
    const response = await POST(req);
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("API returns only actual mission ID for a readable FAILED result", async () => {
  const response = await POST(request(validInput));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { missionId });
});

test("API crash errors do not leak stderr, credentials or server paths", async () => {
  const response = await POST(request({ ...validInput, issue: "crash" }));
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ["error"]);
  assert.doesNotMatch(body.error, /SECRET_CREDENTIAL|private|cli.mjs/);
});

test("missing backend dependencies return a useful service unavailable error", async () => {
  await rm(path.join(fixtureRoot, "node_modules", "tsx", "dist", "cli.mjs"));
  const response = await POST(request(validInput));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /Install the backend dependencies/);
});
