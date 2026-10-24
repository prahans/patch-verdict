import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, stat, symlink, utimes, writeFile } from "node:fs/promises";
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
// Synthetic records live only under fixtureRoot; these are not saved mission IDs.
function nineScenarioCatalog() {
  return [
    ...Array.from({ length: 6 }, (_, index) => `verified-${index + 1}`),
    "review-control", "clock-fixture", "conflicting-contract",
  ].map((id) => scenario(`fixture-${id}`, {
    id, name: id, repositoryUrl: `https://github.com/fixture/${id}`,
  }));
}
async function nineScenarioBundles(catalog, { missing = [], executionFailures = [] } = {}) {
  await Promise.all(catalog.filter((entry) => !missing.includes(entry.id)).map((entry) => {
    const executionFailed = executionFailures.includes(entry.id);
    const verdict = executionFailed ? null
      : entry.id === "conflicting-contract" ? "FAILED"
        : ["review-control", "clock-fixture"].includes(entry.id) ? "REVIEW_REQUIRED" : "VERIFIED";
    return bundle(entry.missionId, {
      mission: { ...proof(entry.missionId).mission, source: { repositoryUrl: entry.repositoryUrl, baseCommit } },
      status: executionFailed ? "FAILED" : "COMPLETED", verdict,
      checks: executionFailed ? null : {
        bugReproducedBeforePatch: true,
        reproductionPassesAfterPatch: true,
        fullSuitePassesAfterPatch: verdict !== "FAILED",
      },
      verificationIntegrity: executionFailed ? null : {
        status: verdict === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "PRESERVED",
        preserved: verdict !== "REVIEW_REQUIRED", violations: [],
        reviewFlags: verdict === "REVIEW_REQUIRED" ? ["PRIVATE_REVIEW_REASON"] : [],
        protectedChangedFiles: [],
      },
    }, executionFailed
      ? [completeEvents[0], event("FAILED", "2026-10-01T00:00:05.000Z")]
      : completeEvents);
  }));
}
async function artifactTime(missionId, timestamp) {
  const date = new Date(timestamp);
  await utimes(path.join(fixtureRoot, "output", missionId, "proof.json"), date, date);
}
function assertUnavailable(result, index = 0) {
  const row = result.benchmarks[index];
  assert.equal(row.availability, "unavailable");
  assert.equal(row.verdict, null);
  assert.equal(row.executionStatus, null);
  assert.equal(row.testDurationMs, null);
  assert.equal(row.evidenceUrl, null);
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
  assert.deepEqual(result.recordedMissions, []);
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
  assert.equal(row.recordedAt, "2026-10-01T00:00:10.000Z");
  assert.equal(row.recordedAtSource, "event");
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

test("seven distinct controlled repositories report six VERIFIED and one saved REVIEW_REQUIRED result", async () => {
  const catalog = Array.from({ length: 7 }, (_, index) => {
    const missionId = `controlled-${index + 1}`;
    return scenario(missionId, { repositoryUrl: `https://github.com/fixture/controlled-${index + 1}` });
  });
  await Promise.all(catalog.map((entry, index) => bundle(entry.missionId, {
    mission: { ...proof(entry.missionId).mission, source: { repositoryUrl: entry.repositoryUrl, baseCommit } },
    verdict: index === 6 ? "REVIEW_REQUIRED" : "VERIFIED",
    verificationIntegrity: index === 6
      ? { status: "REVIEW_REQUIRED", preserved: false, violations: [], reviewFlags: ["PRIVATE_REVIEW_REASON"], protectedChangedFiles: ["tests/state.test.ts"] }
      : { status: "PRESERVED", preserved: true, violations: [], reviewFlags: [], protectedChangedFiles: [] },
  })));
  await Promise.all([
    artifact("controlled-7", "evidence/baseline-test.json", evidence(10, 1)),
    artifact("controlled-7", "evidence/post-patch-test.json", evidence(20, 0)),
    artifact("controlled-7", "evidence/full-suite.json", evidence(30, 0)),
  ]);
  const result = await aggregateBenchmarks(catalog);
  assert.equal(result.benchmarks.length, 7);
  assert.equal(new Set(result.benchmarks.map((row) => row.repository)).size, 7);
  assert.equal(result.summary.configured, 7);
  assert.equal(result.summary.valid, 7);
  assert.equal(result.summary.verified, 6);
  assert.equal(result.summary.reviewRequired, 1);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.unavailable, 0);
  assert.equal(result.summary.noVerdict, 0);
  assert.equal(result.summary.verificationRate, 6 / 7 * 100);
  assert.equal(formatRate(result.summary.verificationRate), "85.7%");
  const review = result.benchmarks[6];
  assert.equal(review.verdict, "REVIEW_REQUIRED");
  assert.equal(review.integrity, "REVIEW_REQUIRED");
  assert.equal(review.baselineReproduced, true);
  assert.equal(review.postPatchPassed, true);
  assert.equal(review.fullSuitePassed, true);
  assert.equal(review.testDurationMs, 60);
  assert.equal(review.evidenceUrl, "/missions/controlled-7");
  assert.equal(result.recordedMissions.length, 7);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REVIEW_REASON/);
});

test("nine distinct controlled scenarios retain six VERIFIED, two REVIEW_REQUIRED and one completed FAILED verdict", async () => {
  const catalog = nineScenarioCatalog();
  await nineScenarioBundles(catalog);
  const before = await snapshot(path.join(fixtureRoot, "output"));
  const result = await aggregateBenchmarks(catalog);
  assert.equal(result.outputState, "available");
  assert.equal(result.benchmarks.length, 9);
  for (const field of ["id", "missionId", "repository"]) {
    assert.equal(new Set(result.benchmarks.map((row) => row[field])).size, 9);
  }
  assert.deepEqual(result.summary, {
    configured: 9, valid: 9, verified: 6, reviewRequired: 2, failed: 1,
    noVerdict: 0, unavailable: 0, validWithoutVerdict: 0, verificationRate: 6 / 9 * 100,
    testDurationMs: null, timedCommandCount: 0, timedMissionCount: 0,
  });
  assert.equal(formatRate(result.summary.verificationRate), "66.7%");
  assert.deepEqual(result.benchmarks.map((row) => [row.missionId, row.executionStatus, row.evidenceUrl]),
    catalog.map((entry) => [entry.missionId, "COMPLETED", `/missions/${entry.missionId}`]));
  assert.deepEqual(result.benchmarks.map((row) => row.repository),
    catalog.map((entry) => `fixture/${entry.id}`));
  const clock = result.benchmarks.find((row) => row.scenario === "clock-fixture");
  assert.equal(clock.verdict, "REVIEW_REQUIRED");
  assert.equal(clock.integrity, "REVIEW_REQUIRED");
  assert.equal(clock.fullSuitePassed, true);
  const negativeControl = result.benchmarks.find((row) => row.scenario === "conflicting-contract");
  assert.equal(negativeControl.verdict, "FAILED");
  assert.equal(negativeControl.executionStatus, "COMPLETED");
  assert.equal(negativeControl.fullSuitePassed, false);
  assert.equal(result.recordedMissions.length, 9);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_/);
  assert.deepEqual(await snapshot(path.join(fixtureRoot, "output")), before);
});

test("nine-scenario metrics keep failed executions and unavailable evidence in the denominator without inventing verdicts", async () => {
  const catalog = nineScenarioCatalog();
  await nineScenarioBundles(catalog, { missing: ["clock-fixture"], executionFailures: ["verified-6"] });
  const result = await aggregateBenchmarks(catalog);
  assert.deepEqual(result.summary, {
    configured: 9, valid: 8, verified: 5, reviewRequired: 1, failed: 1,
    noVerdict: 2, unavailable: 1, validWithoutVerdict: 1, verificationRate: 5 / 9 * 100,
    testDurationMs: null, timedCommandCount: 0, timedMissionCount: 0,
  });
  assert.equal(formatRate(result.summary.verificationRate), "55.6%");
  const failedExecution = result.benchmarks[5];
  assert.equal(failedExecution.availability, "valid");
  assert.equal(failedExecution.executionStatus, "FAILED");
  assert.equal(failedExecution.verdict, null);
  assert.equal(failedExecution.evidenceUrl, "/missions/fixture-verified-6");
  assertUnavailable(result, 7);
  assert.equal(result.benchmarks[8].executionStatus, "COMPLETED");
  assert.equal(result.benchmarks[8].verdict, "FAILED");
  assert.equal(result.benchmarks[8].evidenceUrl, "/missions/fixture-conflicting-contract");
  assert.equal(result.recordedMissions.length, 8);
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
  assert.equal(row.recordedAt, "2026-10-01T00:00:05.000Z");
  assert.equal(row.recordedAtSource, "event");
  assert.equal(row.evidenceUrl, "/missions/setup-failure");
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
  assert.equal(result.recordedMissions.length, 3);
  for (const row of result.recordedMissions) {
    assert.equal(row.availability, "unavailable");
    assert.equal(row.evidenceUrl, null);
    assert.equal(row.verdict, null);
    assert.equal(row.executionStatus, null);
  }
  assert.match(result.benchmarks[2].unavailableReason, /Unsupported proof version/);
});

test("missing configured mission, proof, and required events each remain unavailable", async () => {
  await artifact("no-proof", "events.json", completeEvents);
  await artifact("no-events", "proof.json", proof("no-events"));
  const result = await aggregateBenchmarks([scenario("missing"), scenario("no-proof"), scenario("no-events")]);
  result.benchmarks.forEach((_, index) => assertUnavailable(result, index));
  assert.equal(result.summary.unavailable, 3);
  assert.deepEqual(result.benchmarks.map((row) => row.evidenceUrl), [null, null, null]);
  assert.equal(result.benchmarks[0].recordedAt, null);
  assert.equal(result.benchmarks[0].recordedAtSource, null);
  assert.equal(result.benchmarks[1].recordedAt, null);
  assert.equal(result.benchmarks[1].recordedAtSource, null);
  assert.deepEqual(result.recordedMissions.map((row) => row.missionId), ["no-events"]);
});

test("invalid required metadata and live-only or temporary records are never successful benchmarks", async () => {
  await bundle("wrong-id", { mission: proof("different-id").mission });
  await bundle("running", { status: "RUNNING" });
  await artifact("live-only", "status.json", { status: "RUNNING" });
  await artifact("temporary", "proof.json.tmp", proof("temporary"));
  const result = await aggregateBenchmarks([scenario("wrong-id"), scenario("running"), scenario("live-only"), scenario("temporary")]);
  result.benchmarks.forEach((_, index) => assertUnavailable(result, index));
  assert.equal(result.summary.verified, 0);
  assert.deepEqual(result.recordedMissions.map((row) => row.missionId).sort(), ["running", "wrong-id"]);
  assert.ok(result.recordedMissions.every((row) => row.availability === "unavailable" && row.evidenceUrl === null));
});

test("exact configured mission IDs select controlled runs without inflating metrics from another run", async () => {
  await bundle("first-run", { verdict: "FAILED" });
  await bundle("second-run");
  const result = await aggregateBenchmarks([scenario("first-run")]);
  assert.equal(result.benchmarks.length, 1);
  assert.equal(result.benchmarks[0].missionId, "first-run");
  assert.equal(result.benchmarks[0].verdict, "FAILED");
  assert.deepEqual(result.recordedMissions.map((row) => row.missionId).sort(), ["first-run", "second-run"]);
  assert.equal(result.recordedMissions.find((row) => row.missionId === "first-run").verdict, "FAILED");
  assert.equal(result.summary.verified, 0);
  assert.equal(result.summary.verificationRate, 0);
  const both = await aggregateBenchmarks([scenario("first-run"), scenario("second-run")]);
  assert.equal(both.summary.valid, 2);
  assert.equal(both.summary.verified, 1);
});

test("a newly finalized rerun appears on the next read without replacing the pinned controlled attempt", async () => {
  await bundle("pinned-run", { verdict: "FAILED" }, [
    event("PREPARING", "2026-10-01T00:00:00.000Z"), event("COMPLETED", "2026-10-01T00:00:01.000Z"),
  ]);
  await artifact("new-run", "status.json", { status: "RUNNING" });
  const catalog = [scenario("pinned-run")];
  const initial = await aggregateBenchmarks(catalog);
  assert.deepEqual(initial.recordedMissions.map((row) => row.missionId), ["pinned-run"]);

  await bundle("new-run", {}, [
    event("PREPARING", "2026-10-02T00:00:00.000Z"), event("COMPLETED", "2026-10-02T00:00:02.000Z"),
  ]);
  const refreshed = await aggregateBenchmarks(catalog);
  assert.deepEqual(refreshed.benchmarks, initial.benchmarks);
  assert.deepEqual(refreshed.summary, initial.summary);
  assert.deepEqual(refreshed.recordedMissions.map((row) => [row.missionId, row.verdict]), [
    ["new-run", "VERIFIED"], ["pinned-run", "FAILED"],
  ]);
  assert.equal(refreshed.recordedMissions[0].repository, refreshed.recordedMissions[1].repository);
  assert.equal(refreshed.recordedMissions[0].evidenceUrl, "/missions/new-run");
  assert.equal(refreshed.recordedMissions[1].evidenceUrl, "/missions/pinned-run");
  assert.equal(refreshed.summary.configured, 1);
  assert.equal(refreshed.summary.verified, 0);
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

test("recorded times use reliable terminal events and normalize explicit timezone offsets", async () => {
  await bundle("full-timeline");
  await bundle("terminal-only", {}, [event("COMPLETED", "2026-10-02T05:45:00.000+05:45")]);
  await bundle("failed-timeline", { status: "FAILED", verdict: null }, [
    event("PREPARING", "2026-10-03T00:00:00.000Z"), event("FAILED", "2026-10-03T00:00:03.000Z"),
  ]);
  for (const id of ["full-timeline", "terminal-only", "failed-timeline"]) {
    await artifactTime(id, "2026-10-10T00:00:00.000Z");
  }
  const result = await aggregateBenchmarks(["full-timeline", "terminal-only", "failed-timeline"].map((id) => scenario(id)));
  assert.deepEqual(result.benchmarks.map((row) => [row.recordedAt, row.recordedAtSource]), [
    ["2026-10-01T00:00:10.000Z", "event"],
    ["2026-10-02T00:00:00.000Z", "event"],
    ["2026-10-03T00:00:03.000Z", "event"],
  ]);
  assert.equal(result.benchmarks[1].missionDurationMs, null);
  assert.deepEqual(result.recordedMissions.map((row) => row.missionId), ["failed-timeline", "terminal-only", "full-timeline"]);
});

test("absent or unreliable completion timelines use the artifact save time without inventing duration", async () => {
  const timelines = [
    [],
    completeEvents.slice(0, 2),
    [completeEvents[0], event("FAILED", "2026-10-01T00:00:10.000Z")],
    [event("PREPARING", "2026-10-01T00:00:00"), event("COMPLETED", "2026-10-01T00:00:10")],
    [completeEvents[0], event("BASELINE", "2026-10-01T00:00:11.000Z"), completeEvents[2]],
  ];
  const timestamp = "2026-09-30T12:00:00.000Z";
  for (let index = 0; index < timelines.length; index += 1) {
    await bundle(`fallback-${index}`, {}, timelines[index]);
    await artifactTime(`fallback-${index}`, timestamp);
  }
  const result = await aggregateBenchmarks(timelines.map((_, index) => scenario(`fallback-${index}`)));
  for (const row of result.benchmarks) {
    assert.equal(row.availability, "valid");
    assert.equal(row.recordedAt, timestamp);
    assert.equal(row.recordedAtSource, "artifact");
    assert.equal(row.missionDurationMs, null);
  }
});

test("unsupported proof timestamps remain artifact metadata and do not grant evidence links or verdicts", async () => {
  await bundle("unsupported", { version: 3 });
  const timestamp = "2026-10-04T12:34:56.000Z";
  await artifactTime("unsupported", timestamp);
  const result = await aggregateBenchmarks([scenario("unsupported")]);
  const row = assertUnavailable(result);
  assert.equal(row.recordedAt, timestamp);
  assert.equal(row.recordedAtSource, "artifact");
  assert.match(row.unavailableReason, /Unsupported proof version/);
  assert.equal(result.recordedMissions[0].recordedAt, timestamp);
  assert.equal(result.recordedMissions[0].recordedAtSource, "artifact");
  assert.equal(result.recordedMissions[0].evidenceUrl, null);
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
  assert.deepEqual(result.recordedMissions, []);
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

test("recorded history selects newest saved manifests before capping and still loads pinned older evidence", async () => {
  const ids = ["aaa-oldest-pinned", ...Array.from({ length: BENCHMARK_LIMITS.recordedMissions }, (_, index) => `recording-${String(index).padStart(3, "0")}`)];
  const start = Date.parse("2026-10-01T00:00:00.000Z");
  await Promise.all(ids.map(async (id, index) => {
    await bundle(id, {}, []);
    await artifactTime(id, new Date(start + index * 1000).toISOString());
  }));
  // A directory named proof.json is not a saved manifest and cannot crowd out
  // a valid run merely because its filesystem timestamp is newer.
  await mkdir(path.join(fixtureRoot, "output", "zzz-non-file", "proof.json"), { recursive: true });
  await artifactTime("zzz-non-file", "2030-01-01T00:00:00.000Z");
  const result = await aggregateBenchmarks([scenario("aaa-oldest-pinned")]);
  assert.equal(result.recordedMissions.length, BENCHMARK_LIMITS.recordedMissions);
  assert.equal(result.discoveryTruncated, true);
  assert.ok(result.notices.some((notice) => /could not be inspected safely/.test(notice)));
  assert.deepEqual(result.recordedMissions.map((row) => row.missionId), ids.slice(1).reverse());
  assert.equal(result.benchmarks[0].missionId, "aaa-oldest-pinned");
  assert.equal(result.benchmarks[0].availability, "valid");
  assert.equal(result.summary.configured, 1);
  assert.equal(result.summary.verified, 1);
  assert.equal(result.summary.verificationRate, 100);
  const unconfigured = await aggregateBenchmarks([]);
  assert.equal(unconfigured.recordedMissions.length, BENCHMARK_LIMITS.recordedMissions);
  assert.equal(unconfigured.summary.configured, 0);
  assert.equal(unconfigured.summary.verified, 0);
  assert.equal(unconfigured.summary.verificationRate, null);
});

test("all recorded outcomes remain independent attempts without entering an empty controlled cohort", async () => {
  await Promise.all([
    bundle("verified"),
    bundle("review", { verdict: "REVIEW_REQUIRED" }),
    bundle("repair-failed", { verdict: "FAILED" }),
    bundle("execution-failed", { status: "FAILED", verdict: null }, [event("FAILED", "2026-10-01T00:00:00.000Z")]),
  ]);
  const result = await aggregateBenchmarks([]);
  assert.equal(result.recordedMissions.length, 4);
  const byMission = new Map(result.recordedMissions.map((row) => [row.missionId, row]));
  assert.equal(byMission.get("verified").verdict, "VERIFIED");
  assert.equal(byMission.get("review").verdict, "REVIEW_REQUIRED");
  assert.equal(byMission.get("repair-failed").verdict, "FAILED");
  assert.equal(byMission.get("execution-failed").verdict, null);
  assert.equal(byMission.get("execution-failed").executionStatus, "FAILED");
  assert.equal(byMission.get("execution-failed").evidenceUrl, "/missions/execution-failed");
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
