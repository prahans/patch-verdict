import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import childProcess, { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "server-only"
      ? { url: "data:text/javascript,export {};", shortCircuit: true }
      : nextResolve(specifier.startsWith(".") && !path.extname(specifier) ? specifier + ".ts" : specifier, context);
  },
});

const { createMissionPullRequest, readMissionPullRequest, pullRequestDescription } = await import("../lib/github-pull-request.ts");
const { prepareExactPatch, safePatchPath } = await import("../lib/exact-verified-patch.ts");
const { getPullRequestEligibility, isPullRequestResult } = await import("../lib/pull-request-types.ts");
const { loadProofBundle } = await import("../lib/load-proof-bundle.ts");
const { POST } = await import("../app/api/missions/[missionId]/pull-request/route.ts");

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const originalToken = process.env.PATCHVERDICT_GITHUB_TOKEN;
const missionId = "web-exact-patch";
const repository = "owner/repository";
const branch = `patchverdict/${missionId}`;
const token = "test-token-never-persist-or-return";
const originalFile = "export function divide(a, b) {\n  return a / b;\n}\n";
const repairedFile = "export function divide(a, b) {\n  return b === 0 ? 0 : a / b;\n}\n";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
let fixtureRoot, bundleDirectory, gitDirectory, baseCommit, baseTree, patchedTree, patch, proof, remote;

function git(args, input) {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotePath=false", ...args], {
    cwd: gitDirectory, input, windowsHide: true,
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
      TEMP: process.env.TEMP, TMP: process.env.TMP,
      HOME: fixtureRoot, USERPROFILE: fixtureRoot, GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: path.join(fixtureRoot, "empty-config"),
      GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z",
    },
  });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

function put(file, contents, mode = "100644") {
  const sha = git(["hash-object", "-w", "--stdin"], contents).toString().trim();
  git(["update-index", "--add", "--cacheinfo", `${mode},${sha},${file}`]);
  return sha;
}

async function saveProof() { await writeFile(path.join(bundleDirectory, "proof.json"), JSON.stringify(proof)); }

async function savePatch() {
  patchedTree = git(["write-tree"]).toString().trim();
  patch = git(["diff", "--cached", "--binary", "--no-renames", "--no-ext-diff", baseCommit]);
  proof.patch.sha256 = digest(patch);
  proof.patch.changedFiles = git(["diff", "--cached", "--name-only", "--no-renames", "-z", baseCommit]).toString().split("\0").filter(Boolean);
  await Promise.all([saveProof(), writeFile(path.join(bundleDirectory, "patch.diff"), patch)]);
}

function commitInfo(sha) {
  const tree = git(["show", "-s", "--format=%T", sha]).toString().trim();
  const parents = git(["show", "-s", "--format=%P", sha]).toString().trim().split(" ").filter(Boolean).map((parent) => ({ sha: parent }));
  return { sha, tree: { sha: tree }, parents };
}

function existingCommit(tree = patchedTree, parent = baseCommit) {
  return git(["commit-tree", tree, "-p", parent], "Existing exact repair\n").toString().trim();
}

function existingPr(headSha, overrides = {}) {
  return {
    number: 12, html_url: `https://github.com/${repository}/pull/12`, draft: proof.verdict === "REVIEW_REQUIRED",
    created_at: "2026-10-01T00:00:00Z", state: "open",
    head: { ref: branch, sha: headSha, repo: { full_name: repository } },
    base: { ref: "main", repo: { full_name: repository } }, ...overrides,
  };
}

function apiFixture() {
  const state = { calls: [], branch: null, prs: [], onRequest: undefined };
  globalThis.fetch = async (url, options) => {
    assert.ok(url === `https://api.github.com/repos/${repository}` || url.startsWith(`https://api.github.com/repos/${repository}/`), url);
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    const endpoint = url.slice(`https://api.github.com/repos/${repository}`.length);
    const method = options.method;
    const body = options.body ? JSON.parse(options.body) : undefined;
    const call = { endpoint, method, body };
    state.calls.push(call);
    const override = await state.onRequest?.(call);
    if (override) return override;
    if (endpoint === "") return Response.json({ full_name: repository, default_branch: "main" });
    if (method === "GET" && endpoint.startsWith("/git/commits/")) return Response.json(commitInfo(endpoint.slice("/git/commits/".length)));
    if (method === "GET" && endpoint.startsWith("/git/trees/")) {
      const sha = endpoint.slice("/git/trees/".length).split("?")[0];
      const entries = git(["ls-tree", "-r", "-t", "-z", sha]).toString().split("\0").filter(Boolean).map((line) => {
        const [, mode, type, sha, file] = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
        return { path: file, mode, type, sha };
      });
      return Response.json({ sha, tree: entries, truncated: false });
    }
    if (method === "GET" && endpoint.startsWith("/git/blobs/")) {
      const sha = endpoint.slice("/git/blobs/".length);
      return Response.json({ sha, content: git(["cat-file", "blob", sha]).toString("base64"), encoding: "base64" });
    }
    if (method === "GET" && endpoint.startsWith("/pulls?")) {
      assert.match(endpoint, /state=all&head=owner%3Apatchverdict%2Fweb-exact-patch/);
      return Response.json(state.prs);
    }
    if (method === "GET" && endpoint.startsWith("/git/ref/heads/")) return state.branch
      ? Response.json({ ref: `refs/heads/${branch}`, object: { type: "commit", sha: state.branch } })
      : new Response(null, { status: 404 });
    if (method === "POST" && endpoint === "/git/blobs") {
      assert.equal(body.encoding, "base64");
      return Response.json({ sha: git(["hash-object", "-w", "--stdin"], Buffer.from(body.content, "base64")).toString().trim() });
    }
    if (method === "POST" && endpoint === "/git/trees") {
      assert.equal(body.base_tree, baseTree);
      git(["read-tree", baseTree]);
      for (const item of body.tree) {
        assert.equal(item.type, "blob");
        git(["update-index", "-z", "--index-info"], `${item.sha === null ? "0" : item.mode} ${item.sha ?? "0".repeat(40)}\t${item.path}\0`);
      }
      return Response.json({ sha: git(["write-tree"]).toString().trim() });
    }
    if (method === "POST" && endpoint === "/git/commits") {
      const sha = git(["commit-tree", body.tree, ...body.parents.flatMap((parent) => ["-p", parent])], body.message).toString().trim();
      return Response.json(commitInfo(sha));
    }
    if (method === "POST" && endpoint === "/git/refs") {
      assert.equal(body.ref, `refs/heads/${branch}`);
      state.branch = body.sha;
      return Response.json({ ref: body.ref, object: { sha: body.sha, type: "commit" } });
    }
    if (method === "POST" && endpoint === "/pulls") {
      assert.equal(body.head, branch);
      assert.equal(body.base, "main");
      assert.equal(body.maintainer_can_modify, false);
      const pr = existingPr(state.branch, { draft: body.draft });
      state.prs.push(pr);
      return Response.json(pr);
    }
    assert.fail(`Unexpected request: ${method} ${endpoint}`);
  };
  return state;
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(path.join(testsDirectory, ".pull-request-"));
  bundleDirectory = path.join(fixtureRoot, "output", missionId);
  gitDirectory = path.join(fixtureRoot, "fixture-git");
  await Promise.all([mkdir(bundleDirectory, { recursive: true }), mkdir(gitDirectory), mkdir(path.join(fixtureRoot, "src"))]);
  await Promise.all([
    writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ name: "patch-verdict" })),
    writeFile(path.join(fixtureRoot, "src", "real-mission-demo.ts"), "// fixture marker"),
    writeFile(path.join(fixtureRoot, "empty-config"), ""),
  ]);
  git(["init", "--bare", "."]);
  put("src/divide.ts", originalFile);
  put("unchanged.txt", "unchanged exactly\r\n");
  baseTree = git(["write-tree"]).toString().trim();
  baseCommit = git(["commit-tree", baseTree], "Recorded proof base\n").toString().trim();
  put("src/divide.ts", repairedFile);
  proof = {
    version: 2,
    mission: {
      id: missionId, issue: "Division by zero returns Infinity\n\nReturn zero for a zero denominator.",
      source: { repositoryUrl: `https://github.com/${repository}`, baseCommit },
      reproduction: { label: "Division by zero reproduction", command: "npm test -- divide" },
      fullSuite: { label: "Full suite", command: "npm test" },
      verificationIntegrity: { status: "PRESERVED", preserved: true, violations: [], reviewFlags: [], protectedChangedFiles: [] },
    },
    status: "COMPLETED", verdict: "VERIFIED",
    checks: { bugReproducedBeforePatch: true, reproductionPassesAfterPatch: true, fullSuitePassesAfterPatch: true, verificationIntegrityPreserved: true },
    patch: { applied: true, baseCommit, changedFiles: ["src/divide.ts"] }, artifacts: {},
  };
  await Promise.all([savePatch(), writeFile(path.join(bundleDirectory, "events.json"), "[]")]);
  process.chdir(fixtureRoot);
  process.env.PATCHVERDICT_GITHUB_TOKEN = token;
  remote = apiFixture();
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.PATCHVERDICT_GITHUB_TOKEN;
  else process.env.PATCHVERDICT_GITHUB_TOKEN = originalToken;
  process.chdir(originalCwd);
  assert.equal(path.dirname(path.resolve(fixtureRoot)), testsDirectory);
  assert.ok(path.basename(fixtureRoot).startsWith(".pull-request-"));
  await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const writes = (endpoint) => remote.calls.filter((call) => call.method === "POST" && (!endpoint || call.endpoint === endpoint));
const api = async (endpoint) => (await globalThis.fetch(`https://api.github.com/repos/${repository}${endpoint}`, {
  method: "GET", redirect: "error", cache: "no-store", headers: { Authorization: `Bearer ${token}` },
})).json();

test("VERIFIED publishes the exact patch and proof base with immutable evidence and atomic separate metadata", async (t) => {
  const originalProof = await readFile(path.join(bundleDirectory, "proof.json"));
  const originalSpawn = childProcess.spawn;
  const spy = t.mock.method(childProcess, "spawn", (command, args, options) => {
    assert.equal(command, "git", "Publication must not invoke an AI or application process");
    assert.equal(options.shell, false);
    assert.equal(options.env.PATCHVERDICT_GITHUB_TOKEN, undefined);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(args.join(" ").includes(token), false);
    return originalSpawn(command, args, options);
  });
  syncBuiltinESMExports();
  let result;
  try { result = await createMissionPullRequest(missionId); }
  finally { spy.mock.restore(); syncBuiltinESMExports(); }
  assert.ok(spy.mock.calls.length > 0);
  assert.deepEqual(result, { number: 12, url: `https://github.com/${repository}/pull/12`, draft: false });
  const commit = commitInfo(remote.branch);
  assert.equal(commit.tree.sha, patchedTree);
  assert.deepEqual(commit.parents, [{ sha: baseCommit }]);
  assert.equal(git(["show", `${remote.branch}:src/divide.ts`]).toString(), repairedFile);
  assert.equal(git(["show", `${remote.branch}:unchanged.txt`]).toString(), "unchanged exactly\r\n");
  assert.deepEqual(await readFile(path.join(bundleDirectory, "proof.json")), originalProof);
  assert.deepEqual(await readFile(path.join(bundleDirectory, "patch.diff")), patch);
  const saved = JSON.parse(await readFile(path.join(bundleDirectory, "pull-request.json")));
  assert.equal(saved.patchSha256, digest(patch));
  assert.equal(saved.proofSha256, digest(originalProof));
  assert.equal(saved.baseCommit, baseCommit);
  assert.equal(saved.treeSha, patchedTree);
  assert.equal(saved.branch, branch);
  assert.equal(JSON.stringify(saved).includes(token), false);
  assert.deepEqual((await readdir(bundleDirectory)).sort(), ["events.json", "patch.diff", "proof.json", "pull-request.json"]);
  assert.equal(writes("/pulls").length, 1);
  assert.equal(writes("/pulls")[0].body.draft, false);
  assert.match(writes("/pulls")[0].body.body, /Base commit: [a-f0-9]{40}/);
  assert.match(writes("/pulls")[0].body.body, /Full suite: passed/);
});

test("REVIEW_REQUIRED creates only a draft, includes review reasons, and closes only the canonical same-repository issue", async () => {
  proof.verdict = "REVIEW_REQUIRED";
  proof.checks.verificationIntegrityPreserved = false;
  proof.mission.verificationIntegrity = { status: "REVIEW_REQUIRED", preserved: false, violations: [], reviewFlags: ["Candidate changed protected tests"], protectedChangedFiles: ["src/divide.test.ts"] };
  proof.mission.source.githubIssue = { url: `https://github.com/${repository}/issues/7`, number: 7, owner: "owner", repository: "repository", title: "Division by zero returns Infinity", body: "The reported bug body." };
  await saveProof();
  assert.equal((await createMissionPullRequest(missionId)).draft, true);
  const { body, title } = writes("/pulls")[0].body;
  assert.equal(title, "fix: Division by zero returns Infinity");
  assert.match(body, /Human review is required/);
  assert.match(body, /Candidate changed protected tests/);
  assert.match(body, /Fixes #7/);
  const bundle = await loadProofBundle(missionId);
  bundle.details.source.githubIssue.repository = "different-repository";
  assert.doesNotMatch(pullRequestDescription(bundle), /Fixes/);
});

test("FAILED, execution failures, and contradictory evidence are denied without changing the proof or calling GitHub", async () => {
  const good = structuredClone(proof);
  for (const change of [
    (value) => { value.verdict = "FAILED"; },
    (value) => { value.status = "FAILED"; },
    (value) => { value.patch.applied = false; },
    (value) => { value.patch.changedFiles = []; },
    (value) => { value.patch.baseCommit = "0".repeat(40); },
    (value) => { delete value.mission.source; },
    (value) => { delete value.patch.sha256; },
    (value) => { value.checks.fullSuitePassesAfterPatch = false; },
    (value) => { value.mission.verificationIntegrity.status = "COMPROMISED"; },
    (value) => { value.error = "execution failed"; },
  ]) {
    proof = structuredClone(good);
    change(proof);
    await saveProof();
    const before = await readFile(path.join(bundleDirectory, "proof.json"));
    await assert.rejects(createMissionPullRequest(missionId), { name: "PullRequestError", status: 409 });
    assert.deepEqual(await readFile(path.join(bundleDirectory, "proof.json")), before);
  }
  assert.equal(remote.calls.length, 0);
});

test("missing and corrupt canonical artifacts, invalid IDs, and missing token fail with safe PR-only errors", async () => {
  for (const id of ["../escape", "x/y", "x\\y", "a".repeat(101), "", "%2f"]) {
    await assert.rejects(createMissionPullRequest(id), { status: 400 });
  }
  delete process.env.PATCHVERDICT_GITHUB_TOKEN;
  await assert.rejects(createMissionPullRequest(missionId), { status: 503, message: "Pull request creation is not configured on this PatchVerdict server." });
  assert.equal((await loadProofBundle(missionId)).mission.verdict, "VERIFIED");
  process.env.PATCHVERDICT_GITHUB_TOKEN = token;
  for (const filename of ["proof.json", "patch.diff", "events.json"]) {
    const location = path.join(bundleDirectory, filename);
    const bytes = await readFile(location);
    await unlink(location);
    await assert.rejects(createMissionPullRequest(missionId), /missing, unreadable, or invalid/);
    await writeFile(location, bytes);
  }
  await writeFile(path.join(bundleDirectory, "proof.json"), "{broken json");
  await assert.rejects(createMissionPullRequest(missionId), /missing, unreadable, or invalid/);
  assert.equal(remote.calls.length, 0);
});

test("exact patch validation rejects changed bytes, mismatched changed-file sets, wrong base data, and unsupported paths", async () => {
  await writeFile(path.join(bundleDirectory, "patch.diff"), Buffer.concat([patch, Buffer.from("\n")]));
  await assert.rejects(createMissionPullRequest(missionId), /digest/);
  assert.equal(remote.calls.length, 0);
  await writeFile(path.join(bundleDirectory, "patch.diff"), patch);
  proof.patch.changedFiles.push("unchanged.txt");
  await saveProof();
  await assert.rejects(createMissionPullRequest(missionId), /changed-file set/);
  assert.equal(writes().length, 0);
  proof.patch.changedFiles = ["src/divide.ts"];
  await saveProof();
  remote.onRequest = ({ endpoint }) => endpoint === `/git/commits/${baseCommit}`
    ? Response.json({ ...commitInfo(baseCommit), sha: "0".repeat(40) }) : undefined;
  await assert.rejects(createMissionPullRequest(missionId), /base commit/);
  for (const file of ["../outside", "/absolute", "C:/outside", "dir\\file", ".git/config", "x/../y", "x//y", "trailing.", "x\0y"]) assert.equal(safePatchPath(file), false, file);
});

test("real Git preserves text bytes, addition, deletion, and executable modes exactly", async () => {
  put("src/divide.ts", repairedFile.replaceAll("\n", "\r\n"), "100755");
  put("new/notes.txt", "New UTF-8 notes: café\n");
  git(["update-index", "-z", "--index-info"], `0 ${"0".repeat(40)}\tunchanged.txt\0`);
  await savePatch();
  await createMissionPullRequest(missionId);
  assert.equal(commitInfo(remote.branch).tree.sha, patchedTree);
  assert.equal(git(["show", `${remote.branch}:src/divide.ts`]).toString(), repairedFile.replaceAll("\n", "\r\n"));
  assert.match(git(["ls-tree", remote.branch, "src/divide.ts"]).toString(), /^100755 blob/);
  assert.equal(git(["show", `${remote.branch}:new/notes.txt`]).toString(), "New UTF-8 notes: café\n");
  assert.equal(writes("/git/trees")[0].body.tree.find((item) => item.path === "unchanged.txt").sha, null);
});

test("binary patches, symlinks, and submodules cannot be silently published", async () => {
  for (const invalid of [Buffer.from("GIT binary patch\n"), Buffer.from([0xff, 0xfe]), Buffer.from("abc\0def")]) {
    await assert.rejects(prepareExactPatch(api, baseCommit, ["src/divide.ts"], invalid), /Binary, invalid, or oversized/);
  }
  put("link", "src/divide.ts", "120000");
  await savePatch();
  await assert.rejects(createMissionPullRequest(missionId), /symlinks, submodules/);
  git(["read-tree", baseTree]);
  git(["update-index", "--add", "--cacheinfo", `160000,${baseCommit},nested`]);
  await savePatch();
  await assert.rejects(createMissionPullRequest(missionId), /symlinks, submodules/);
  assert.equal(writes().length, 0);
});

test("repeat and concurrent requests reuse one PR, including after refresh and without a token", async () => {
  const [first, second] = await Promise.all([createMissionPullRequest(missionId), createMissionPullRequest(missionId)]);
  assert.deepEqual(second, first);
  assert.equal(writes("/pulls").length, 1);
  const count = remote.calls.length;
  delete process.env.PATCHVERDICT_GITHUB_TOKEN;
  assert.deepEqual(await createMissionPullRequest(missionId), first);
  assert.deepEqual(await readMissionPullRequest(missionId), first);
  assert.equal(remote.calls.length, count);
});

test("an exact existing deterministic branch is reused and a different branch commit is rejected", async () => {
  remote.branch = existingCommit(baseTree);
  await assert.rejects(createMissionPullRequest(missionId), /exact recorded patch and base commit/);
  assert.equal(writes().length, 0);
  remote.branch = existingCommit();
  await createMissionPullRequest(missionId);
  assert.equal(writes("/git/blobs").length, 0);
  assert.equal(writes("/git/commits").length, 0);
  assert.equal(writes("/pulls").length, 1);
});

test("a closed matching PR is recovered even if its branch was deleted, without opening another PR", async () => {
  remote.prs = [existingPr(existingCommit(), { state: "closed" })];
  const result = await createMissionPullRequest(missionId);
  assert.equal(result.number, 12);
  assert.equal(writes().length, 0);
  assert.deepEqual(await readMissionPullRequest(missionId), result);
});

test("local persistence failure after GitHub success recovers the existing PR on retry", async () => {
  remote.onRequest = async ({ endpoint, method }) => {
    if (endpoint === "/pulls" && method === "POST") await mkdir(path.join(bundleDirectory, "pull-request.json"));
  };
  await assert.rejects(createMissionPullRequest(missionId), /local record could not be saved/);
  assert.equal(writes("/pulls").length, 1);
  const obstruction = path.resolve(bundleDirectory, "pull-request.json");
  assert.equal(path.dirname(obstruction), path.resolve(bundleDirectory));
  await rm(obstruction, { recursive: true });
  remote.onRequest = undefined;
  const result = await createMissionPullRequest(missionId);
  assert.equal(result.number, 12);
  assert.equal(writes("/pulls").length, 1);
  assert.deepEqual(await readMissionPullRequest(missionId), result);
});

test("uncertain GitHub PR success is recovered from its branch instead of posting again", async () => {
  remote.onRequest = ({ endpoint, method, body }) => {
    if (endpoint === "/pulls" && method === "POST") {
      remote.prs.push(existingPr(remote.branch, { draft: body.draft }));
      throw new Error(`${token} raw GitHub transport failure`);
    }
  };
  assert.equal((await createMissionPullRequest(missionId)).number, 12);
  assert.equal(writes("/pulls").length, 1);
});

test("untrusted saved metadata never exposes arbitrary links and is bound to all canonical proof bytes", async () => {
  await createMissionPullRequest(missionId);
  const location = path.join(bundleDirectory, "pull-request.json");
  const saved = JSON.parse(await readFile(location));
  for (const override of [
    { url: "https://attacker.invalid/pull/12" }, { number: -1 }, { draft: true },
    { repository: "owner/other" }, { branch: "other" }, { headSha: "bad" },
    { baseCommit: "0".repeat(40) }, { patchSha256: "0".repeat(64) }, { proofSha256: "0".repeat(64) },
  ]) {
    await writeFile(location, JSON.stringify({ ...saved, ...override }));
    assert.equal(await readMissionPullRequest(missionId), null);
  }
  await writeFile(location, JSON.stringify(saved));
  proof.patch.changedFiles.push("unchanged.txt");
  await saveProof();
  assert.equal(await readMissionPullRequest(missionId), null);
  await assert.rejects(createMissionPullRequest(missionId), /changed-file set/);
  assert.equal(writes("/pulls").length, 1);
  assert.equal(isPullRequestResult({ number: 12, url: "https://github.com/owner/repository/pull/12#bad", draft: false }), false);
});

test("GitHub errors remain bounded and never leak tokens, raw responses, paths, or alter the verdict", async () => {
  const before = await readFile(path.join(bundleDirectory, "proof.json"));
  for (const [status, headers, expected] of [[401, {}, 403], [403, {}, 403], [403, { "x-ratelimit-remaining": "0" }, 429], [429, {}, 429], [500, {}, 502], [422, {}, 409]]) {
    remote.onRequest = () => new Response(`${token} C:\\private\\file raw response`, { status, headers });
    await assert.rejects(createMissionPullRequest(missionId), (error) => {
      assert.equal(error.status, expected);
      assert.doesNotMatch(error.message, /test-token|private|raw response/);
      assert.ok(error.message.length < 300);
      return true;
    });
  }
  assert.deepEqual(await readFile(path.join(bundleDirectory, "proof.json")), before);
});

test("tampered remote blobs and trees are rejected before any branch or PR write", async () => {
  remote.onRequest = ({ endpoint }) => endpoint.startsWith("/git/blobs/")
    ? Response.json({ sha: endpoint.split("/").at(-1), encoding: "base64", content: Buffer.from("different base bytes").toString("base64") }) : undefined;
  await assert.rejects(createMissionPullRequest(missionId), /base file does not match/);
  assert.equal(writes().length, 0);
  remote.onRequest = ({ endpoint, method }) => endpoint === "/git/trees" && method === "POST"
    ? Response.json({ sha: "0".repeat(40) }) : undefined;
  await assert.rejects(createMissionPullRequest(missionId), /created tree differs/);
  assert.equal(writes("/git/refs").length, 0);
  assert.equal(writes("/pulls").length, 0);
});

test("publication never rebases onto an advanced branch and refuses a recovered commit with the wrong parent", async () => {
  const advanced = git(["commit-tree", baseTree, "-p", baseCommit], "Default branch advanced\n").toString().trim();
  remote.branch = existingCommit(patchedTree, advanced);
  await assert.rejects(createMissionPullRequest(missionId), /exact recorded patch and base commit/);
  assert.equal(writes().length, 0);
  remote.branch = null;
  await createMissionPullRequest(missionId);
  assert.deepEqual(writes("/git/commits")[0].body.parents, [baseCommit]);
  assert.equal(writes("/pulls")[0].body.base, "main");
});

test("proof mutation during publication stops before opening a PR", async () => {
  remote.onRequest = async ({ endpoint, method }) => {
    if (endpoint === "/git/refs" && method === "POST") {
      proof.mission.issue = "Modified canonical context after publication started";
      await saveProof();
    }
  };
  await assert.rejects(createMissionPullRequest(missionId), /artifacts changed during publication/);
  assert.equal(writes("/pulls").length, 0);
  assert.equal(proof.verdict, "VERIFIED");
});

test("filesystem locks prevent another process from publishing and stale locks permit safe recovery", async () => {
  const location = path.join(bundleDirectory, ".pull-request.lock");
  await writeFile(location, "");
  await assert.rejects(createMissionPullRequest(missionId), /already in progress/);
  assert.equal(remote.calls.length, 0);
  const stale = new Date(Date.now() - 11 * 60000);
  await utimes(location, stale, stale);
  assert.equal((await createMissionPullRequest(missionId)).number, 12);
  assert.equal(writes("/pulls").length, 1);
});

test("mission directory junctions cannot escape output storage", async () => {
  const external = path.join(fixtureRoot, "outside-output");
  await mkdir(external);
  await symlink(external, path.join(fixtureRoot, "output", "escaped"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(createMissionPullRequest("escaped"), /outside the permitted storage directory/);
  assert.equal(remote.calls.length, 0);
});

test("PR route rejects cross-site writes and client canonical data, and returns only bounded public fields", async () => {
  const url = `http://localhost/api/missions/${missionId}/pull-request`;
  const context = { params: Promise.resolve({ missionId }) };
  for (const headers of [{ origin: "https://attacker.invalid" }, { "sec-fetch-site": "cross-site" }]) {
    assert.equal((await POST(new Request(url, { method: "POST", headers }), context)).status, 403);
  }
  assert.equal((await POST(new Request(url, { method: "POST", body: JSON.stringify({ verdict: "VERIFIED", repositoryUrl: "https://github.com/other/repo" }) }), context)).status, 400);
  assert.equal(remote.calls.length, 0);
  const emptyBodyResponse = await POST(new Request(url, { method: "POST", body: "", headers: { origin: "http://localhost" } }), context);
  assert.equal(emptyBodyResponse.status, 200);
  const emptyBodyResult = await emptyBodyResponse.json();
  assert.deepEqual(Object.keys(emptyBodyResult).sort(), ["draft", "number", "url"]);
  const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" } }), context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(Object.keys(await response.json()).sort(), ["draft", "number", "url"]);
});

test("presentation policy denies conflicting checks while retaining the recorded verdict", async () => {
  const bundle = await loadProofBundle(missionId);
  bundle.mission.evidence = { postPatchTest: { command: "npm test", exitCode: 1, stdout: "", stderr: "", durationMs: 1 } };
  assert.equal(getPullRequestEligibility(bundle.mission, bundle.details).allowed, false);
  assert.equal(bundle.mission.verdict, "VERIFIED");
});
