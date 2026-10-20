import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The server marker is enforced by Next; these Node tests have no client graph.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { url: "data:text/javascript,export {};", shortCircuit: true }
      : nextResolve(specifier.startsWith(".") && !path.extname(specifier) ? `${specifier}.ts` : specifier, context);
  },
});
const { aggregateBenchmarks, BENCHMARK_LIMITS } = await import("../lib/benchmarks/aggregate.ts");
const { formatRate } = await import("../lib/benchmarks/presentation.ts");
const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
const repositoryUrl = "https://github.com/fixture/controlled-repository";
const baseCommit = "a".repeat(40);
let fixtureRoot;

const scenario = (missionId = "controlled-run", overrides = {}) => ({
  id: `scenario-${missionId}`, name: `Scenario ${missionId}`, repositoryUrl, missionId, ...overrides,
});
const event = (state, timestamp) => ({ state, timestamp, message: "PRIVATE_EVENT_DETAIL" });
const completeEvents = [
  event("PREPARING", "2026-10-01T00:00:00.000Z"),
  event("BASELINE", "2026-10-01T00:00:01.000Z"),
  event("COMPLETED", "2026-10-01T00:00:10.000Z"),
];
function proof(missionId, overrides = {}) {
  return {
    version: 2,
    mission: {
      id: missionId,
      issue: "PRIVATE_ISSUE_BODY",
      reproduction: { label: "Reproduction", command: "npm test -- reproduce" },
      fullSuite: { label: "Full suite", command: "npm test" },
      source: { repositoryUrl, baseCommit },
    },
    status: "COMPLETED", verdict: "VERIFIED",
    checks: { bugReproducedBeforePatch: true, reproductionPassesAfterPatch: true, fullSuitePassesAfterPatch: true },
    patch: { applied: true, baseCommit, changedFiles: ["src/divide.ts", "src/index.ts"] },
    investigation: { iterations: 3 }, artifacts: {},
    ...overrides,
  };
}
const evidence = (durationMs, exitCode = 0) => ({
  command: "PRIVATE_COMMAND", stdout: "PRIVATE_STDOUT", stderr: "PRIVATE_STDERR", durationMs, exitCode,
});
async function artifact(missionId, filename, value) {
  const target = path.join(fixtureRoot, "output", missionId, filename);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === "string" ? value : JSON.stringify(value), "utf8");
}
async function bundle(missionId = "controlled-run", overrides = {}, events = completeEvents) {
  await Promise.all([
    artifact(missionId, "proof.json", proof(missionId, overrides)),
    artifact(missionId, "events.json", events),
  ]);
}
function assertUnavailable(result, index = 0) {
  const row = result.benchmarks[index];
  assert.equal(row.availability, "unavailable");
  assert.equal(row.verdict, null);
  assert.equal(row.executionStatus, null);
  assert.equal(row.testDurationMs, null);
  assert.ok(row.unavailableReason);
  assert.doesNotMatch(row.unavailableReason, /PRIVATE_|[A-Z]:\\|\.proof-loader-|\.benchmarks-/);
  return row;
}
async function snapshot(directory) {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result[entry.name] = await snapshot(target);
    else {
      const metadata = await stat(target);
      result[entry.name] = { hash: createHash("sha256").update(await readFile(target)).digest("hex"), mtime: metadata.mtimeMs };
    }
  }
  return result;
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(testsDirectory, ".benchmarks-"));
  const appDirectory = path.join(fixtureRoot, "apps", "web");
  await Promise.all([
    mkdir(appDirectory, { recursive: true }), mkdir(path.join(fixtureRoot, "src")), mkdir(path.join(fixtureRoot, "output")),
  ]);
  await Promise.all([
    writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "patch-verdict" })),
    writeFile(path.join(fixtureRoot, "src", "real-mission-demo.ts"), "// repository marker"),
  ]);
  process.chdir(appDirectory);
});
afterEach(async () => {
  process.chdir(originalCwd);
  assert.equal(path.dirname(path.resolve(fixtureRoot)), testsDirectory);
  assert.ok(path.basename(fixtureRoot).startsWith(".benchmarks-"));
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("empty output and an empty catalog have no fabricated results or verification rate", async () => {
  const result = await aggregateBenchmarks([]);
  assert.equal(result.outputState, "available");
  assert.deepEqual(result.benchmarks, []);
  assert.deepEqual(result.otherMissions, []);
  assert.deepEqual(result.summary, {
    configured: 0, valid: 0, verified: 0, reviewRequired: 0, failed: 0, noVerdict: 0,
    unavailable: 0, validWithoutVerdict: 0, verificationRate: null,
    testDurationMs: null, timedCommandCount: 0, timedMissionCount: 0,
  });
});

test("a missing output directory returns a safe unavailable configured row", async () => {
  await rmdir(path.join(fixtureRoot, "output"));
  const result = await aggregateBenchmarks([scenario()]);
  assert.equal(result.outputState, "missing");
  assertUnavailable(result);
  assert.equal(result.summary.configured, 1);
  assert.equal(result.summary.verificationRate, 0);
});

test("valid VERIFIED proof projects trusted metadata and keeps command time distinct from overall duration", async () => {
  await bundle("controlled-run", { verificationIntegrity: {
    status: "PRESERVED", preserved: true, violations: [], reviewFlags: [], protectedChangedFiles: [],
  } });
  await Promise.all([
    artifact("controlled-run", "evidence/baseline-test.json", evidence(100, 1)),
    artifact("controlled-run", "evidence/post-patch-test.json", evidence(200)),
    artifact("controlled-run", "evidence/full-suite.json", evidence(300)),
    artifact("controlled-run", "investigation.md", "PRIVATE_INVESTIGATION"),
    artifact("controlled-run", "patch.diff", "PRIVATE_PATCH"),
  ]);
  const result = await aggregateBenchmarks([scenario()]);
  const row = result.benchmarks[0];
  assert.equal(row.availability, "valid");
  assert.equal(row.executionStatus, "COMPLETED");
  assert.equal(row.verdict, "VERIFIED");
  assert.equal(row.repository, "fixture/controlled-repository");
  assert.equal(row.baselineReproduced, true);
  assert.equal(row.postPatchPassed, true);
  assert.equal(row.fullSuitePassed, true);
  assert.equal(row.integrity, "PRESERVED");
  assert.equal(row.changedFiles, 2);
  assert.equal(row.baseCommit, baseCommit);
  assert.equal(row.iterations, 3);
  assert.equal(row.testDurationMs, 600);
  assert.equal(row.timedCommandCount, 3);
  assert.deepEqual(row.commandDurations, { baseline: 100, postPatch: 200, fullSuite: 300 });
  assert.equal(row.missionDurationMs, 10_000);
  assert.equal(row.evidenceUrl, "/missions/controlled-run");
  assert.equal(result.summary.verified, 1);
  assert.equal(result.summary.verificationRate, 100);
  assert.equal(result.summary.testDurationMs, 600);
  assert.equal(result.summary.timedMissionCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|stdout|stderr|\.benchmarks-/);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

test("REVIEW_REQUIRED and completed FAILED verdicts retain recorded execution status", async () => {
  await bundle("review", { verdict: "REVIEW_REQUIRED", verificationIntegrity: {
    status: "REVIEW_REQUIRED", preserved: false, violations: [], reviewFlags: ["PRIVATE_REVIEW_REASON"], protectedChangedFiles: ["test.ts"],
  } });
  await bundle("failed", { verdict: "FAILED", checks: { fullSuitePassesAfterPatch: false } });
  const result = await aggregateBenchmarks([scenario("review"), scenario("failed")]);
  assert.deepEqual(result.benchmarks.map((row) => [row.executionStatus, row.verdict]), [["COMPLETED", "REVIEW_REQUIRED"], ["COMPLETED", "FAILED"]]);
  assert.equal(result.benchmarks[0].integrity, "REVIEW_REQUIRED");
  assert.equal(result.benchmarks[1].fullSuitePassed, false);
  assert.equal(result.summary.reviewRequired, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.summary.verificationRate, 0);
});

test("failed execution with null verdict is valid evidence, not a FAILED repair verdict", async () => {
  await bundle("setup-failure", { status: "FAILED", verdict: null, patch: null, checks: null, investigation: null, error: "PRIVATE_ERROR" }, [
    completeEvents[0], event("FAILED", "2026-10-01T00:00:05.000Z"),
  ]);
  const result = await aggregateBenchmarks([scenario("setup-failure")]);
  const row = result.benchmarks[0];
  assert.equal(row.availability, "valid");
  assert.equal(row.executionStatus, "FAILED");
  assert.equal(row.verdict, null);
  assert.equal(row.missionDurationMs, 5000);
  for (const key of ["changedFiles", "iterations", "baselineReproduced", "testDurationMs"]) assert.equal(row[key], null);
  assert.equal(row.baseCommit, baseCommit);
  assert.equal(result.summary.validWithoutVerdict, 1);
  assert.equal(result.summary.noVerdict, 1);
  assert.equal(result.summary.unavailable, 0);
  assert.equal(result.summary.failed, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_ERROR/);
});

test("missing optional evidence stays missing without inferred zeros or integrity", async () => {
  await bundle("optional", { investigation: null, patch: null, checks: null });
  const { benchmarks: [row], summary } = await aggregateBenchmarks([scenario("optional")]);
  assert.equal(row.availability, "valid");
  for (const key of ["testDurationMs", "integrity", "changedFiles", "iterations", "baselineReproduced", "postPatchPassed", "fullSuitePassed"]) assert.equal(row[key], null);
  assert.equal(row.timedCommandCount, 0);
  assert.deepEqual(row.commandDurations, { baseline: null, postPatch: null, fullSuite: null });
  assert.equal(summary.testDurationMs, null);
});

test("corrupt JSON and unsupported proof versions never count a raw VERIFIED string", async () => {
  for (const [missionId, value] of [["corrupt", '{"verdict":"VERIFIED",PRIVATE_SECRET'], ["old", proof("old", { version: 1 })], ["future", proof("future", { version: 3 })]]) {
    await bundle(missionId);
    await artifact(missionId, "proof.json", value);
  }
  const result = await aggregateBenchmarks([scenario("corrupt"), scenario("old"), scenario("future")]);
  result.benchmarks.forEach((_, index) => assertUnavailable(result, index));
  assert.equal(result.summary.verified, 0);
  assert.equal(result.summary.valid, 0);
  assert.equal(result.summary.noVerdict, 3);
});

test("missing configured mission, proof, and required events each remain unavailable", async () => {
  await artifact("no-proof", "events.json", completeEvents);
  await artifact("no-events", "proof.json", proof("no-events"));
  const result = await aggregateBenchmarks([scenario("missing"), scenario("no-proof"), scenario("no-events")]);
  result.benchmarks.forEach((_, index) => assertUnavailable(result, index));
  assert.equal(result.summary.unavailable, 3);
  assert.deepEqual(result.benchmarks.map((row) => row.evidenceUrl), ["/missions/missing", "/missions/no-proof", "/missions/no-events"]);
});

test("invalid required metadata and live-only or temporary records are never successful benchmarks", async () => {
  await bundle("wrong-id", { mission: proof("different-id").mission });
  await bundle("running", { status: "RUNNING" });
  await artifact("live-only", "status.json", { status: "RUNNING" });
  await artifact("temporary", "proof.json.tmp", proof("temporary"));
  const result = await aggregateBenchmarks([scenario("wrong-id"), scenario("running"), scenario("live-only"), scenario("temporary")]);
  result.benchmarks.forEach((_, index) => assertUnavailable(result, index));
  assert.equal(result.summary.verified, 0);
  assert.deepEqual(result.otherMissions, []);
});

test("exact configured mission IDs select controlled runs without inflating metrics from another run", async () => {
  await bundle("first-run", { verdict: "FAILED" });
  await bundle("second-run");
  const result = await aggregateBenchmarks([scenario("first-run")]);
  assert.equal(result.benchmarks.length, 1);
  assert.equal(result.benchmarks[0].missionId, "first-run");
  assert.equal(result.benchmarks[0].verdict, "FAILED");
  assert.deepEqual(result.otherMissions.map((row) => row.missionId), ["second-run"]);
  assert.equal(result.summary.verified, 0);
  assert.equal(result.summary.verificationRate, 0);
  const both = await aggregateBenchmarks([scenario("first-run"), scenario("second-run")]);
  assert.equal(both.summary.valid, 2);
  assert.equal(both.summary.verified, 1);
});

test("repository mismatch or missing repository identity excludes a configured proof", async () => {
  await bundle("mismatch", { mission: { ...proof("mismatch").mission, source: { repositoryUrl: "https://github.com/fixture/other", baseCommit } } });
  await bundle("missing-identity", { mission: { ...proof("missing-identity").mission, source: undefined } });
  const result = await aggregateBenchmarks([scenario("mismatch"), scenario("missing-identity")]);
  assertUnavailable(result, 0);
  assertUnavailable(result, 1);
  assert.equal(result.summary.verified, 0);
});

test("verification rate divides VERIFIED by every configured scenario, including absent and no-verdict runs", async () => {
  await bundle("verified");
  await bundle("review", { verdict: "REVIEW_REQUIRED" });
  await bundle("failed", { verdict: "FAILED" });
  await bundle("no-verdict", { status: "FAILED", verdict: null });
  await bundle("unrelated");
  const result = await aggregateBenchmarks(["verified", "review", "failed", "no-verdict", "missing"].map((id) => scenario(id)));
  assert.equal(result.summary.configured, 5);
  assert.equal(result.summary.valid, 4);
  assert.equal(result.summary.verified, 1);
  assert.equal(result.summary.reviewRequired, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.summary.validWithoutVerdict, 1);
  assert.equal(result.summary.unavailable, 1);
  assert.equal(result.summary.noVerdict, 2);
  assert.equal(result.summary.verificationRate, 20);
  assert.match(formatRate(result.summary.verificationRate), /^20(?:\.0)?%$/);
});

test("all genuinely valid VERIFIED controlled runs produce 100 percent", async () => {
  await Promise.all([bundle("one"), bundle("two"), bundle("three")]);
  const result = await aggregateBenchmarks(["one", "two", "three"].map((id) => scenario(id)));
  assert.equal(result.summary.verified, 3);
  assert.equal(result.summary.verificationRate, 100);
  assert.match(formatRate(result.summary.verificationRate), /^100(?:\.0)?%$/);
});

test("stage results use validated command exits only when the explicit recorded check is absent", async () => {
  await bundle("command-results", { checks: null });
  await bundle("explicit-checks", { checks: { reproductionPassesAfterPatch: false, fullSuitePassesAfterPatch: true } });
  for (const id of ["command-results", "explicit-checks"]) await Promise.all([
    artifact(id, "evidence/baseline-test.json", evidence(10, 1)),
    artifact(id, "evidence/post-patch-test.json", evidence(10, 0)),
    artifact(id, "evidence/full-suite.json", evidence(10, 1)),
  ]);
  const { benchmarks: [commands, explicit] } = await aggregateBenchmarks([scenario("command-results"), scenario("explicit-checks")]);
  assert.equal(commands.postPatchPassed, true);
  assert.equal(commands.fullSuitePassed, false);
  assert.equal(commands.baselineReproduced, null);
  assert.equal(explicit.postPatchPassed, false);
  assert.equal(explicit.fullSuitePassed, true);
});

test("partial measured durations sum only validated evidence and retain an actual zero", async () => {
  await Promise.all([bundle("partial"), bundle("zero"), bundle("untimed")]);
  await Promise.all([
    artifact("partial", "evidence/baseline-test.json", evidence(400, 1)),
    artifact("partial", "evidence/post-patch-test.json", evidence(-1)),
    artifact("partial", "evidence/full-suite.json", evidence(200)),
    artifact("zero", "evidence/full-suite.json", evidence(0)),
  ]);
  const result = await aggregateBenchmarks(["partial", "zero", "untimed"].map((id) => scenario(id)));
  assert.equal(result.benchmarks[0].testDurationMs, 600);
  assert.equal(result.benchmarks[0].timedCommandCount, 2);
  assert.equal(result.benchmarks[0].evidenceWarnings, true);
  assert.deepEqual(result.benchmarks[0].commandDurations, { baseline: 400, postPatch: null, fullSuite: 200 });
  assert.equal(result.benchmarks[1].testDurationMs, 0);
  assert.equal(result.benchmarks[1].timedCommandCount, 1);
  assert.equal(result.benchmarks[2].testDurationMs, null);
  assert.equal(result.summary.testDurationMs, 600);
  assert.equal(result.summary.timedCommandCount, 3);
  assert.equal(result.summary.timedMissionCount, 2);
});

test("overall duration requires a full ordered timeline with a matching terminal state", async () => {
  const timelines = [
    completeEvents.slice(1), [], completeEvents.slice(0, 2),
    [completeEvents[0], event("FAILED", "2026-10-01T00:00:10.000Z")],
    [completeEvents[0], event("BASELINE", "2026-10-01T00:00:11.000Z"), completeEvents[2]],
  ];
  for (let index = 0; index < timelines.length; index += 1) await bundle(`timeline-${index}`, {}, timelines[index]);
  const result = await aggregateBenchmarks(timelines.map((_, index) => scenario(`timeline-${index}`)));
  for (const row of result.benchmarks) {
    assert.equal(row.availability, "valid");
    assert.equal(row.missionDurationMs, null);
  }
});

test("invalid and path-traversal mission IDs cannot create evidence links or valid records", async () => {
  const ids = ["../outside", "../../secret", "a/b", "a\\b", ".", "", "id%2fsecret", "bad?token=secret"];
  const result = await aggregateBenchmarks(ids.map((id, index) => scenario(id, { id: `invalid-${index}` })));
  result.benchmarks.forEach((row, index) => {
    assertUnavailable(result, index);
    assert.equal(row.evidenceUrl, null);
  });
  assert.equal(result.summary.verified, 0);
});

test("duplicate scenario identifiers and mission IDs cannot double-count evidence", async () => {
  await Promise.all([bundle("one"), bundle("two")]);
  for (const catalog of [
    [scenario("one"), scenario("one", { id: "another-scenario" })],
    [scenario("one", { id: "duplicate" }), scenario("two", { id: "duplicate" })],
  ]) {
    const result = await aggregateBenchmarks(catalog);
    assert.ok(result.summary.verified <= 1);
    assert.ok(result.summary.unavailable >= 1);
    assert.equal(result.summary.configured, 2);
    assert.ok(result.summary.verificationRate <= 50);
  }
});

test("symlinked mission and output directories cannot escape the allowed directory", async () => {
  const outside = path.join(fixtureRoot, "outside-output");
  await mkdir(outside);
  await Promise.all([
    writeFile(path.join(outside, "proof.json"), JSON.stringify(proof("escaped"))),
    writeFile(path.join(outside, "events.json"), JSON.stringify(completeEvents)),
  ]);
  await symlink(outside, path.join(fixtureRoot, "output", "escaped"), "junction");
  assertUnavailable(await aggregateBenchmarks([scenario("escaped")]));
  // Remove only the checked link, never recursively traverse its target.
  await rm(path.join(fixtureRoot, "output", "escaped"));
  await rmdir(path.join(fixtureRoot, "output"));
  await symlink(outside, path.join(fixtureRoot, "output"), "junction");
  assertUnavailable(await aggregateBenchmarks([scenario("escaped")]));
});

test("symlinked evidence is never followed outside its saved mission", async () => {
  await bundle();
  const outside = path.join(fixtureRoot, "outside-evidence");
  await mkdir(outside);
  await writeFile(path.join(outside, "baseline-test.json"), JSON.stringify(evidence(123)));
  await symlink(outside, path.join(fixtureRoot, "output", "controlled-run", "evidence"), "junction");
  const result = await aggregateBenchmarks([scenario()]);
  assert.equal(result.benchmarks[0].testDurationMs, null);
  assert.equal(result.summary.testDurationMs, null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
});

test("untrusted artifact metadata cannot choose filesystem paths and explicit null excludes stale evidence", async () => {
  await bundle("null-artifacts", { artifacts: { evidence: null, patch: null, investigation: null } });
  await artifact("null-artifacts", "evidence/baseline-test.json", evidence(900));
  await bundle("untrusted-paths", { artifacts: { evidence: { baseline: "../../secret.json" }, events: "../../secret.json" } });
  await writeFile(path.join(fixtureRoot, "secret.json"), JSON.stringify(evidence(999)));
  const result = await aggregateBenchmarks([scenario("null-artifacts"), scenario("untrusted-paths")]);
  assert.equal(result.summary.valid, 2);
  assert.equal(result.summary.testDurationMs, null);
  assert.equal(result.benchmarks[0].timedCommandCount, 0);
  assert.equal(result.benchmarks[1].timedCommandCount, 0);
});

test("oversized artifacts and oversized bundles are rejected before loading", async () => {
  await bundle("large-proof");
  await artifact("large-proof", "proof.json", JSON.stringify(proof("large-proof")) + " ".repeat(BENCHMARK_LIMITS.artifactBytes));
  await bundle("large-bundle");
  const largeEvidence = { ...evidence(1), stdout: "x".repeat(BENCHMARK_LIMITS.artifactBytes - 1024) };
  await Promise.all([
    artifact("large-bundle", "investigation.md", "x".repeat(BENCHMARK_LIMITS.artifactBytes)),
    artifact("large-bundle", "patch.diff", "x".repeat(BENCHMARK_LIMITS.artifactBytes)),
    ...["baseline-test", "post-patch-test", "full-suite"].map((name) => artifact("large-bundle", `evidence/${name}.json`, largeEvidence)),
  ]);
  const result = await aggregateBenchmarks([scenario("large-proof"), scenario("large-bundle")]);
  assertUnavailable(result, 0);
  assertUnavailable(result, 1);
  assert.equal(result.summary.verified, 0);
});

test("discovery is bounded even when output contains many unrelated directory entries", async () => {
  await Promise.all(Array.from({ length: BENCHMARK_LIMITS.scannedEntries + 2 }, (_, index) => artifact(`unfinalized-${index}`, "status.json", { status: "RUNNING" })));
  const result = await aggregateBenchmarks([]);
  assert.equal(result.discoveryTruncated, true);
  assert.deepEqual(result.otherMissions, []);
  assert.equal(result.summary.configured, 0);
  assert.ok(result.notices.length > 0);
});

test("oversized catalogs fail closed instead of reporting a rate for a truncated cohort", async () => {
  const result = await aggregateBenchmarks(Array.from({ length: BENCHMARK_LIMITS.catalog + 1 }, (_, index) => scenario(`configured-${index}`)));
  assert.equal(result.outputState, "unavailable");
  assert.deepEqual(result.benchmarks, []);
  assert.equal(result.summary.verificationRate, null);
  assert.ok(result.notices.length > 0);
});

test("other recordings are capped and never added to controlled summary metrics", async () => {
  await Promise.all(Array.from({ length: BENCHMARK_LIMITS.otherMissions + 1 }, (_, index) => bundle(`recording-${index}`)));
  const result = await aggregateBenchmarks([]);
  assert.equal(result.otherMissions.length, BENCHMARK_LIMITS.otherMissions);
  assert.equal(result.discoveryTruncated, true);
  assert.equal(result.summary.configured, 0);
  assert.equal(result.summary.verified, 0);
  assert.equal(result.summary.verificationRate, null);
});

test("aggregation is read-only and subsequent calls observe changed saved evidence", async () => {
  await bundle();
  await artifact("controlled-run", "evidence/baseline-test.json", evidence(100));
  await artifact("controlled-run", "patch.diff", "PRIVATE_PATCH");
  const output = path.join(fixtureRoot, "output");
  const before = await snapshot(output);
  await aggregateBenchmarks([scenario()]);
  await aggregateBenchmarks([]);
  assert.deepEqual(await snapshot(output), before);
  await artifact("controlled-run", "proof.json", proof("controlled-run", { verdict: "FAILED" }));
  const updated = await aggregateBenchmarks([scenario()]);
  assert.equal(updated.benchmarks[0].verdict, "FAILED");
  assert.equal(updated.summary.verified, 0);
});
