import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks } from "node:module";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Next enforces this marker at build time; standalone Node tests have no client graph.
registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { url: "data:text/javascript,export {};", shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { loadProofBundle } = await import("../lib/load-proof-bundle.ts");

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
const missionId = "fixture-divide-zero";
let fixtureRoot;
let bundleDirectory;

const evidence = {
  command: "npm test",
  exitCode: 1,
  stdout: "real test output\n",
  stderr: "failure details\n",
  durationMs: 840,
};
const events = [{
  timestamp: "2026-10-03T05:15:49.469Z",
  state: "BASELINE",
  message: "Bug reproduced",
}];

function proof(overrides = {}) {
  return {
    version: 2,
    mission: {
      id: missionId,
      issue: "\n\n  divide() should reject division by zero.\n\nExpected behavior:\nThrow an error.\n",
      reproduction: { label: "rejects division by zero", command: "npm test -- divide.test.ts" },
      fullSuite: { label: "Repository full test suite", command: "npm test" },
    },
    status: "COMPLETED",
    verdict: "VERIFIED",
    checks: {
      bugReproducedBeforePatch: true,
      reproductionPassesAfterPatch: true,
      fullSuitePassesAfterPatch: true,
    },
    patch: { applied: true, baseCommit: "real-base-commit", changedFiles: ["src/divide.ts"] },
    artifacts: {},
    ...overrides,
  };
}

async function writeArtifact(filename, value) {
  const destination = path.join(bundleDirectory, filename);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, typeof value === "string" ? value : JSON.stringify(value), "utf8");
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(testsDirectory, ".proof-loader-"));
  const appDirectory = path.join(fixtureRoot, "apps", "web");
  bundleDirectory = path.join(fixtureRoot, "output", missionId);
  await Promise.all([mkdir(appDirectory, { recursive: true }), mkdir(bundleDirectory, { recursive: true })]);
  process.chdir(appDirectory);
  await Promise.all([writeArtifact("proof.json", proof()), writeArtifact("events.json", events)]);
});

afterEach(async () => {
  process.chdir(originalCwd);
  // Every disposable fixture is a direct child of this test directory.
  assert.equal(path.dirname(path.resolve(fixtureRoot)), testsDirectory);
  assert.ok(path.basename(fixtureRoot).startsWith(".proof-loader-"));
  await rm(fixtureRoot, { recursive: true, force: true });
});

test("normalizes real fields and preserves artifact contents and raw durations", async () => {
  const report = "# Investigation Report\n\nThe actual investigation.\n";
  const diff = "diff --git a/src/divide.ts b/src/divide.ts\n+if (b === 0) throw Error();\n";
  await Promise.all([
    writeArtifact("proof.json", proof({ investigation: { iterations: 7 } })),
    writeArtifact("investigation.md", report),
    writeArtifact("patch.diff", diff),
    writeArtifact("evidence/baseline-test.json", evidence),
    writeArtifact("evidence/post-patch-test.json", { ...evidence, exitCode: 0 }),
    writeArtifact("evidence/full-suite.json", { ...evidence, exitCode: 0 }),
  ]);
  const result = await loadProofBundle(missionId);
  assert.deepEqual(result.details, {
    id: missionId,
    title: "divide() should reject division by zero.",
    description: "Expected behavior:\nThrow an error.",
    reproduction: proof().mission.reproduction,
    fullSuite: proof().mission.fullSuite,
  });
  assert.equal(result.mission.status, "COMPLETED");
  assert.equal(result.mission.verdict, "VERIFIED");
  assert.deepEqual(result.mission.investigation, { report, iterations: 7 });
  assert.equal(result.mission.patch.baseCommit, "real-base-commit");
  assert.deepEqual(result.mission.patch.changedFiles, ["src/divide.ts"]);
  assert.equal(result.mission.patch.diff, diff);
  assert.deepEqual(result.mission.events, events);
  assert.deepEqual(result.mission.evidence.baselineTest, evidence);
  assert.equal(result.mission.evidence.baselineTest.durationMs, 840);
  assert.deepEqual(result.warnings, []);
});

test("bundles leave unknown iterations and optional artifacts unavailable", async () => {
  const result = await loadProofBundle(missionId);
  assert.equal(result.mission.investigation, undefined);
  assert.equal(result.mission.patch.diff, undefined);
  assert.equal(result.mission.evidence, undefined);
  assert.equal(result.details.repository, undefined);
  assert.deepEqual(result.warnings, []);
});

const reviewIntegrity = {
  status: "REVIEW_REQUIRED",
  preserved: false,
  violations: [],
  reviewFlags: [
    "Candidate modified protected test file(s): src/components/DarkMode.test.tsx",
  ],
  protectedChangedFiles: ["src/components/DarkMode.test.tsx"],
};

test("loads the writer's nested review integrity with exact reasons and a completed mission", async () => {
  const reviewProof = proof({
    verdict: "REVIEW_REQUIRED",
    checks: { ...proof().checks, verificationIntegrityPreserved: false },
    mission: { ...proof().mission, verificationIntegrity: reviewIntegrity },
  });
  await writeArtifact("proof.json", reviewProof);

  const { mission } = await loadProofBundle(missionId);
  assert.equal(mission.status, "COMPLETED");
  assert.equal(mission.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(mission.verificationIntegrity, reviewIntegrity);
  assert.deepEqual(mission.checks, reviewProof.checks);
});

test("retains every recorded integrity state from nested and top-level metadata", async () => {
  const states = [
    { status: "PRESERVED", preserved: true, violations: [], reviewFlags: [], protectedChangedFiles: [] },
    reviewIntegrity,
    {
      status: "COMPROMISED", preserved: false,
      violations: ["Candidate removed protected verification command"],
      reviewFlags: [], protectedChangedFiles: ["package.json"],
    },
  ];

  for (const integrity of states) {
    for (const location of ["nested", "top-level"]) {
      await writeArtifact("proof.json", proof(location === "nested"
        ? { mission: { ...proof().mission, verificationIntegrity: integrity } }
        : { verificationIntegrity: integrity }));

      const { mission } = await loadProofBundle(missionId);
      assert.deepEqual(mission.verificationIntegrity, integrity, `${location}: ${integrity.status}`);
      // The frontend displays the recorded verdict; it must not recompute it.
      assert.equal(mission.verdict, "VERIFIED");
    }
  }
});

test("missing or null integrity stays unavailable without inferring it from checks or verdict", async () => {
  for (const metadata of [
    {},
    { verificationIntegrity: null },
    { mission: { ...proof().mission, verificationIntegrity: null } },
  ]) {
    for (const preserved of [true, false]) {
      await writeArtifact("proof.json", proof({
        ...metadata,
        verdict: "REVIEW_REQUIRED",
        checks: { verificationIntegrityPreserved: preserved },
      }));
      const { mission } = await loadProofBundle(missionId);
      assert.equal(mission.verificationIntegrity, undefined);
      assert.equal(mission.checks.verificationIntegrityPreserved, preserved);
      assert.equal(mission.verdict, "REVIEW_REQUIRED");
    }
  }
});

test("top-level integrity takes precedence, including explicit null", async () => {
  const preserved = {
    status: "PRESERVED", preserved: true, violations: [], reviewFlags: [], protectedChangedFiles: [],
  };
  for (const integrity of [preserved, null]) {
    await writeArtifact("proof.json", proof({
      mission: { ...proof().mission, verificationIntegrity: reviewIntegrity },
      verificationIntegrity: integrity,
    }));
    assert.deepEqual((await loadProofBundle(missionId)).mission.verificationIntegrity, integrity ?? undefined);
  }
});

test("validates integrity metadata in either location without losing the source field in errors", async () => {
  for (const [field, invalidValue] of [
    ["status", "UNKNOWN"],
    ["preserved", "false"],
    ["violations", [42]],
    ["reviewFlags", [""]],
    ["protectedChangedFiles", "src/components/DarkMode.test.tsx"],
  ]) {
    for (const location of ["nested", "top-level"]) {
      const integrity = { ...reviewIntegrity, [field]: invalidValue };
      await writeArtifact("proof.json", proof(location === "nested"
        ? { mission: { ...proof().mission, verificationIntegrity: integrity } }
        : { verificationIntegrity: integrity }));
      const source = location === "nested" ? "mission\\.verificationIntegrity" : " verificationIntegrity";
      await assert.rejects(loadProofBundle(missionId), new RegExp(`${source}\\.${field}`));
    }
  }
});

test("failed missions retain null verdict and absent patch, checks, and evidence", async () => {
  await writeArtifact("proof.json", proof({
    status: "FAILED", verdict: null, checks: null, patch: null, error: "Sandbox setup failed",
  }));
  const result = await loadProofBundle(missionId);
  assert.equal(result.mission.status, "FAILED");
  assert.equal(result.mission.verdict, null);
  assert.equal(result.mission.patch, undefined);
  assert.equal(result.mission.checks, undefined);
  assert.equal(result.mission.evidence, undefined);
  assert.equal(result.mission.error, "Sandbox setup failed");
});

test("null artifact declarations exclude stale files from earlier successful runs", async () => {
  await Promise.all([
    writeArtifact("proof.json", proof({
      status: "FAILED", verdict: null, patch: null, investigation: null, checks: null,
      artifacts: { patch: null, investigation: null, evidence: null, events: "events.json" },
    })),
    writeArtifact("investigation.md", "Old success report"),
    writeArtifact("patch.diff", "Old successful patch"),
    writeArtifact("evidence/baseline-test.json", evidence),
    writeArtifact("evidence/post-patch-test.json", { ...evidence, exitCode: 0 }),
    writeArtifact("evidence/full-suite.json", { ...evidence, exitCode: 0 }),
  ]);
  const result = await loadProofBundle(missionId);
  assert.equal(result.mission.patch, undefined);
  assert.equal(result.mission.investigation, undefined);
  assert.equal(result.mission.evidence, undefined);
  assert.deepEqual(result.warnings, []);
});

test("per-artifact null excludes only that evidence while absent legacy fields use fixed paths", async () => {
  await Promise.all([
    writeArtifact("proof.json", proof({ artifacts: { patch: null, evidence: { postPatch: null } } })),
    writeArtifact("patch.diff", "Old patch"),
    writeArtifact("investigation.md", "Legacy report without iteration metadata"),
    writeArtifact("evidence/baseline-test.json", evidence),
    writeArtifact("evidence/post-patch-test.json", { ...evidence, exitCode: 0 }),
  ]);
  const result = await loadProofBundle(missionId);
  assert.equal(result.mission.patch.diff, undefined);
  assert.deepEqual(result.mission.evidence, { baselineTest: evidence });
  assert.deepEqual(result.mission.investigation, { report: "Legacy report without iteration metadata" });
});

test("older failed bundles use the last FAILED event when error is absent", async () => {
  await writeArtifact("proof.json", proof({ status: "FAILED", verdict: null, patch: null }));
  await writeArtifact("events.json", [
    ...events,
    { ...events[0], state: "FAILED", message: "Earlier failure" },
    { ...events[0], state: "FAILED", message: "Final failure details" },
  ]);
  assert.equal((await loadProofBundle(missionId)).mission.error, "Final failure details");
});

test("malformed optional evidence is excluded with a useful warning", async () => {
  await Promise.all([
    writeArtifact("evidence/baseline-test.json", "{broken"),
    writeArtifact("evidence/post-patch-test.json", { ...evidence, durationMs: -1 }),
    writeArtifact("evidence/full-suite.json", evidence),
  ]);
  const result = await loadProofBundle(missionId);
  assert.deepEqual(result.mission.evidence, { fullSuite: evidence });
  assert.equal(result.warnings.length, 2);
  assert.match(result.warnings[0], /baseline-test.json.*Invalid JSON/);
  assert.match(result.warnings[1], /post-patch-test.json.*durationMs/);
});

test("rejects missing and malformed required artifacts descriptively", async () => {
  await rm(path.join(bundleDirectory, "proof.json"));
  await assert.rejects(loadProofBundle(missionId), /Required proof artifact proof.json is missing/);
  await writeArtifact("proof.json", "{broken");
  await assert.rejects(loadProofBundle(missionId), /Invalid JSON in proof.json/);
  await writeArtifact("proof.json", proof());
  await rm(path.join(bundleDirectory, "events.json"));
  await assert.rejects(loadProofBundle(missionId), /Required proof artifact events.json is missing/);
  await writeArtifact("events.json", "not JSON");
  await assert.rejects(loadProofBundle(missionId), /Invalid JSON in events.json/);
});

test("rejects invalid required metadata, evidence shape, and events", async () => {
  for (const [overrides, expected] of [
    [{ version: 1 }, /version 2/],
    [{ status: "RUNNING" }, /status/],
    [{ verdict: "UNKNOWN" }, /verdict/],
    [{ mission: { ...proof().mission, id: "different-id" } }, /mission.id/],
    [{ mission: { ...proof().mission, issue: "  " } }, /mission.issue/],
    [{ checks: { ...proof().checks, fullSuitePassesAfterPatch: "true" } }, /fullSuitePassesAfterPatch/],
    [{ checks: { verificationIntegrityPreserved: "false" } }, /verificationIntegrityPreserved/],
    [{ patch: { ...proof().patch, changedFiles: [42] } }, /changedFiles/],
    [{ investigation: { iterations: 1.5 } }, /iterations/],
  ]) {
    await writeArtifact("proof.json", proof(overrides));
    await assert.rejects(loadProofBundle(missionId), expected);
  }
  await writeArtifact("proof.json", proof());
  for (const [value, expected] of [
    [{}, /events.json.*array/],
    [[{ ...events[0], timestamp: "not a date" }], /timestamp/],
    [[{ ...events[0], state: "UNKNOWN" }], /state/],
    [[{ ...events[0], message: 42 }], /message/],
  ]) {
    await writeArtifact("events.json", value);
    await assert.rejects(loadProofBundle(missionId), expected);
  }
  await writeArtifact("events.json", events);
  await writeArtifact("evidence/baseline-test.json", { ...evidence, exitCode: "0" });
  const result = await loadProofBundle(missionId);
  assert.equal(result.mission.evidence, undefined);
  assert.match(result.warnings[0], /exitCode/);
});

test("validates IDs and never follows artifact paths declared by proof.json", async () => {
  for (const invalidId of ["../secret", "../../secret", "a/b", "a\\b", ".", "", "id%2fsecret"]) {
    await assert.rejects(loadProofBundle(invalidId), /Invalid mission ID/);
  }
  await assert.rejects(loadProofBundle("not-generated"), /Proof bundle output\/not-generated was not found/);
  await writeArtifact("proof.json", proof({ artifacts: {
    patch: "../../secret.diff",
    events: "../../secret.json",
    evidence: { baseline: "../../secret.json" },
  } }));
  const result = await loadProofBundle(missionId);
  assert.deepEqual(result.mission.events, events);
  assert.equal(result.mission.patch.diff, undefined);
  assert.equal(result.mission.evidence, undefined);
});

test("refuses mission directories linked outside output", async () => {
  const outsideOutput = path.join(fixtureRoot, "outside-output");
  await mkdir(outsideOutput);
  await symlink(outsideOutput, path.join(fixtureRoot, "output", "escaped"), "junction");
  await assert.rejects(loadProofBundle("escaped"), /mission directory.*outside the allowed proof directory/);
});

test("excludes optional evidence linked outside the mission directory", async () => {
  const outsideMission = path.join(fixtureRoot, "outside-mission");
  await mkdir(outsideMission);
  await writeFile(path.join(outsideMission, "baseline-test.json"), JSON.stringify(evidence));
  await symlink(outsideMission, path.join(bundleDirectory, "evidence"), "junction");
  const result = await loadProofBundle(missionId);
  assert.equal(result.mission.evidence, undefined);
  assert.match(result.warnings[0], /baseline-test.json.*outside the allowed proof directory/);
});

test("a changed proof artifact is reflected by the next load", async () => {
  const first = await loadProofBundle(missionId);
  const changedProof = JSON.parse(await readFile(path.join(bundleDirectory, "proof.json"), "utf8"));
  changedProof.mission.issue = "Updated real title\n\nUpdated real description";
  changedProof.verdict = "FAILED";
  await writeArtifact("proof.json", changedProof);
  const next = await loadProofBundle(missionId);
  assert.notEqual(next.details.title, first.details.title);
  assert.equal(next.details.title, "Updated real title");
  assert.equal(next.mission.verdict, "FAILED");
});
