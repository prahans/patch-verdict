import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import path from "node:path";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier.startsWith(".") && !path.extname(specifier) ? specifier + ".ts" : specifier, context);
  },
});

const { isSafeMissionId, parseBackendEventLine } = await import("../lib/mission-live-types.ts");
const { buildLiveProofChain } = await import("../lib/live-proof-chain.ts");
const missionId = "web-parser-test";
const line = (state, message, id = missionId) => `PATCHVERDICT EVENT ${id}: [${state}] ${message}`;
const event = (state, message) => ({ state, message, timestamp: "2026-10-11T00:00:00.000Z" });
const chain = (events, status = "RUNNING", phase = events.at(-1)?.state ?? "PREPARING") =>
  buildLiveProofChain({ events, status, phase });
const find = (steps, id) => steps.find((step) => step.id === id);

test("safe mission IDs allow only ASCII letters, numbers, hyphens and underscores", () => {
  for (const id of ["web-123", "A_b-C09", "real-project-hash"]) assert.equal(isSafeMissionId(id), true);
  for (const id of ["", ".", "..", "../proof", "a/b", "a\\b", "%2f", ".runs", "a b", "a\n", "a\0", "café"])
    assert.equal(isSafeMissionId(id), false, JSON.stringify(id));
});

test("parser accepts known messages only with the exact server mission ID", () => {
  for (const [state, message] of [
    ["PREPARING", "Preparing repository..."],
    ["BASELINE", "Reported bug reproduced"],
    ["INVESTIGATING", "AI investigation completed"],
    ["PATCHING", "Git captured 12 changed file(s)"],
    ["VERIFYING", "Reproduction test passes after correction"],
    ["VERDICT", "Calculating deterministic verdict"],
    ["COMPLETED", "Mission completed with verdict REVIEW_REQUIRED"],
  ]) assert.deepEqual(parseBackendEventLine(line(state, message) + "\r", missionId), { state, message });
  for (const text of [
    "[COMPLETED] Mission completed with verdict VERIFIED",
    line("COMPLETED", "Mission completed with verdict VERIFIED", "web-wrong"),
    "prefix " + line("BASELINE", "Reported bug reproduced"),
    line("BASELINE", "Reported bug reproduced") + " trailing",
    line("VERIFYING", "SECRET_CREDENTIAL /server/private"),
    line("OTHER", "Reported bug reproduced"),
    line("PATCHING", "Git captured -1 changed file(s)"),
    "PATCHVERDICT RUN START: " + missionId,
  ]) assert.equal(parseBackendEventLine(text, missionId), null, text);
});

test("parser sanitizes failure and integrity reasons before they enter live status", () => {
  for (const [state, raw, message] of [
    ["FAILED", "SECRET_CREDENTIAL /server/private", "The backend reported a failure. Recording available proof."],
    ["PATCHING", "Verification requires human review: /server/private", "Verification requires human review"],
    ["PATCHING", "Verification integrity compromised: SECRET_CREDENTIAL", "Verification integrity compromised"],
  ]) assert.deepEqual(parseBackendEventLine(line(state, raw), missionId), { state, message });
});

test("eight live checks remain waiting until specific evidence arrives, regardless of phase", () => {
  const steps = chain([], "RUNNING", "VERDICT");
  assert.equal(steps.length, 8);
  assert.ok(steps.every((step) => step.state === "WAITING"));
  const sparse = chain([event("COMPLETED", "Mission completed with verdict VERIFIED")], "COMPLETED");
  assert.equal(find(sparse, "verdict").state, "PASSED");
  assert.ok(sparse.slice(0, 7).every((step) => step.state === "WAITING"));
});

test("real successful events satisfy each proof check in order", () => {
  const steps = chain([
    event("BASELINE", "Running reproduction test before patch"), event("BASELINE", "Reported bug reproduced"),
    event("INVESTIGATING", "AI investigation started"), event("INVESTIGATING", "AI investigation completed"),
    event("PATCHING", "AI patch phase started"), event("PATCHING", "Candidate patch applied"),
    event("PATCHING", "Git captured 2 changed file(s)"), event("PATCHING", "Git diff captured"),
    event("PATCHING", "Verification integrity preserved"),
    event("VERIFYING", "Running reproduction test after patch"), event("VERIFYING", "Reproduction test passes after patch"),
    event("VERIFYING", "Running full test suite"), event("VERIFYING", "Full test suite passes"),
    event("VERDICT", "Calculating deterministic verdict"), event("COMPLETED", "Mission completed with verdict VERIFIED"),
  ], "COMPLETED");
  assert.ok(steps.every((step) => step.state === "PASSED"));
  assert.equal(find(steps, "verdict").detail, "VERIFIED");
});

test("only the current evidence check runs; later phases do not imply a missing check passed", () => {
  const steps = chain([
    event("BASELINE", "Running reproduction test before patch"),
    event("INVESTIGATING", "AI investigation started"),
  ]);
  assert.equal(find(steps, "baseline").state, "WAITING");
  assert.equal(find(steps, "investigation").state, "RUNNING");
  assert.equal(steps.filter((step) => step.state === "RUNNING").length, 1);
});

test("correction retains reproduction failure until an actual rerun starts and passes", () => {
  const events = [
    event("VERIFYING", "Running reproduction test after patch"),
    event("VERIFYING", "Reproduction test still fails"),
    event("PATCHING", "Reproduction failed; starting the single correction attempt"),
  ];
  assert.equal(find(chain(events), "reproduction").state, "FAILED");
  assert.ok(chain(events).every((step) => step.state !== "RUNNING"));
  events.push(event("VERIFYING", "Running reproduction test after correction"));
  assert.equal(find(chain(events), "reproduction").state, "RUNNING");
  events.push(event("VERIFYING", "Reproduction test passes after correction"));
  assert.equal(find(chain(events), "reproduction").state, "PASSED");
});

test("review integrity and deterministic review verdict remain distinct from passing execution", () => {
  const steps = chain([
    event("PATCHING", "Verification requires human review"),
    event("VERIFYING", "Reproduction test passes after patch"),
    event("VERIFYING", "Full test suite passes"),
    event("COMPLETED", "Mission completed with verdict REVIEW_REQUIRED"),
  ], "COMPLETED");
  assert.equal(find(steps, "integrity").state, "REVIEW");
  assert.equal(find(steps, "reproduction").state, "PASSED");
  assert.equal(find(steps, "suite").state, "PASSED");
  assert.equal(find(steps, "verdict").state, "REVIEW");
  assert.equal(find(steps, "verdict").detail, "REVIEW_REQUIRED");
});

test("recorded failures remain failed and execution failure does not fabricate missing evidence", () => {
  const steps = chain([
    event("PATCHING", "Verification integrity compromised"),
    event("VERIFYING", "Reproduction test still fails after correction; no correction attempts remain"),
    event("VERIFYING", "Running full test suite"),
  ], "FAILED", "FAILED");
  assert.equal(find(steps, "integrity").state, "FAILED");
  assert.equal(find(steps, "reproduction").state, "FAILED");
  assert.equal(find(steps, "suite").state, "FAILED");
  assert.equal(find(steps, "verdict").detail, "EXECUTION FAILED");
  assert.equal(find(steps, "baseline").state, "WAITING");
});

test("valid FAILED verdict is represented as saved proof, without changing passed checks", () => {
  const steps = chain([
    event("BASELINE", "Reported bug reproduced"),
    event("VERIFYING", "Full test suite fails"),
    event("COMPLETED", "Mission completed with verdict FAILED"),
  ], "COMPLETED");
  assert.equal(find(steps, "baseline").state, "PASSED");
  assert.equal(find(steps, "suite").state, "FAILED");
  assert.equal(find(steps, "verdict").detail, "FAILED");
  assert.ok(steps.every((step) => step.state !== "RUNNING"));
});


test("strict live events keep background failure separate from issue reproduction", () => {
  const before = [event("BASELINE", "Capturing untouched background suite"), event("BASELINE", "Stable pre-existing failures recorded")];
  const state = { mode: "THIRD_PARTY_JS_TS", status: "RUNNING", phase: "BASELINE", events: before };
  const initial = buildLiveProofChain(state);
  assert.equal(find(initial, "baseline").state, "REVIEW");
  assert.equal(find(initial, "target").state, "WAITING");
  const messages = ["Searching for issue-specific reproduction", "Generating bounded regression test", "Target reproduced and frozen"];
  for (const message of messages) {
    assert.deepEqual(parseBackendEventLine(line("REPRODUCING", message), missionId), { state: "REPRODUCING", message });
    state.events.push(event("REPRODUCING", message));
  }
  state.events.push(event("VERIFYING", "Comparing non-target suite failures"));
  const later = buildLiveProofChain(state);
  assert.equal(find(later, "target").state, "PASSED");
  assert.equal(find(later, "reproduction").state, "WAITING");
  assert.equal(find(later, "suite").state, "RUNNING");
  assert.equal(parseBackendEventLine(line("REPRODUCING", "SECRET_TOKEN from repository"), missionId), null);
});
