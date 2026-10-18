import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import childProcess, { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proofV3Fixture } from "./helpers/proof-v3-fixture.mjs";

registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { url: "data:text/javascript,export {};", shortCircuit: true }
    : next(specifier.startsWith(".") && !path.extname(specifier) ? specifier + ".ts" : specifier, context);
} });
const { publishFork, forkCommitPlan } = await import("../lib/github-fork-publication.ts");
const { pullRequestDescription, createMissionPullRequest, readMissionPullRequest } = await import("../lib/github-pull-request.ts");
const { PullRequestError } = await import("../lib/exact-verified-patch.ts");
const { loadProofBundle } = await import("../lib/load-proof-bundle.ts");
const { POST } = await import("../app/api/missions/[missionId]/pull-request/route.ts");
const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const originalCwd = process.cwd();
const originalFetch = globalThis.fetch;
const originalToken = process.env.PATCHVERDICT_GITHUB_TOKEN;
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const token = "fork-integration-token-never-leak";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const original = "export const divide = (a, b) => a / b;\n";
const repaired = "export const divide = (a, b) => b === 0 ? 0 : a / b;\n";
const regression = "test('division by zero', () => expect(divide(4, 0)).toBe(0));\n";
const upstreamName = "upstream/project";
const user = { login: "publisher", id: 22, type: "User" };
let directory, gitDirectory, source, remote, clients, baseTree, patchedTree;

function git(args, input, override = {}, optional = false) {
  const result = spawnSync("git", ["-c", "core.autocrlf=false", "-c", "core.quotePath=false", ...args], {
    cwd: gitDirectory, input, windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR, TEMP: process.env.TEMP, TMP: process.env.TMP,
      HOME: directory, USERPROFILE: directory, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(directory, "empty-config"),
      GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid",
      GIT_AUTHOR_DATE: "2026-10-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T00:00:00Z", ...override },
  });
  if (optional && result.status !== 0) return null;
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}
function put(file, content) {
  const sha = git(["hash-object", "-w", "--stdin"], content).toString().trim();
  git(["update-index", "--add", "--cacheinfo", `100644,${sha},${file}`]);
  return sha;
}
function commitInfo(sha) {
  if (!git(["cat-file", "-e", sha + "^{commit}"], undefined, {}, true)) return null;
  return { sha, tree: { sha: git(["show", "-s", "--format=%T", sha]).toString().trim() },
    parents: git(["show", "-s", "--format=%P", sha]).toString().trim().split(" ").filter(Boolean).map(sha => ({ sha })),
    message: git(["show", "-s", "--format=%B", sha]).toString().trimEnd() };
}
function repository(fullName, id, ownerId, fork = false) {
  const [login, name] = fullName.split("/");
  return { id, full_name: fullName, name, owner: { login, id: ownerId }, private: false, fork, default_branch: "main",
    ...(fork ? { parent: { id: 11, full_name: upstreamName }, source: { id: 11, full_name: upstreamName } } : {}) };
}
function existingPr(sha, override = {}) {
  return { number: 9, html_url: `https://github.com/${upstreamName}/pull/9`, draft: source.draft, state: "open", created_at: "2026-10-01T00:00:00Z",
    head: { ref: source.branch, sha, repo: remote.fork }, base: { ref: source.bundle.details.source.targetBranch, repo: remote.upstream }, ...override };
}
function createCommit(body) {
  return git(["commit-tree", body.tree, ...body.parents.flatMap(parent => ["-p", parent])], body.message, {
    GIT_AUTHOR_NAME: body.author.name, GIT_AUTHOR_EMAIL: body.author.email, GIT_AUTHOR_DATE: body.author.date,
    GIT_COMMITTER_NAME: body.committer.name, GIT_COMMITTER_EMAIL: body.committer.email, GIT_COMMITTER_DATE: body.committer.date,
  }).toString().trim();
}
function savePatch() {
  patchedTree = git(["write-tree"]).toString().trim();
  source.patch = git(["diff", "--cached", "--binary", "--no-renames", "--no-ext-diff", source.baseCommit]);
  source.patchSha256 = digest(source.patch);
  source.bundle.mission.patch.changedFiles = git(["diff", "--cached", "--name-only", "--no-renames", "-z", source.baseCommit]).toString().split("\0").filter(Boolean);
}
const posts = endpoint => remote.calls.filter(call => call.method === "POST" && (!endpoint || call.endpoint === endpoint));

beforeEach(async () => {
  directory = await mkdtemp(path.join(testsDirectory, ".fork-publication-"));
  gitDirectory = path.join(directory, "git");
  await mkdir(gitDirectory);
  await writeFile(path.join(directory, "empty-config"), "");
  git(["init", "--bare", "."]);
  put("src/divide.ts", original);
  put("src/divide.test.ts", regression);
  baseTree = git(["write-tree"]).toString().trim();
  const baseCommit = git(["commit-tree", baseTree], "Base\n").toString().trim();
  put("src/divide.ts", repaired);
  source = {
    directory, repository: upstreamName, owner: "upstream", name: "project", baseCommit, proofSha256: "b".repeat(64), patchSha256: "", patch: Buffer.alloc(0), branch: "patchverdict/mission-fork", draft: false, publicationTimestamp: "2026-10-01T12:34:56.000Z",
    bundle: { warnings: [], details: { id: "mission-fork", title: "Division by zero", source: { mode: "THIRD_PARTY_JS_TS", repositoryUrl: `https://github.com/${upstreamName}`, targetBranch: "release/2.x", defaultBranch: "main", baseCommit,
      githubIssue: { owner: "upstream", repository: "project", number: 123, title: "Division by zero" } } },
      mission: { status: "COMPLETED", outcome: "REPAIR_EVALUATED", verdict: "VERIFIED", events: [{ timestamp: "2026-10-01T12:34:56.000Z" }], patch: { changedFiles: [] },
        frozenReproduction: { origin: "EXISTING_TEST", framework: "vitest", testPath: "src/divide.test.ts", testIdentity: "division by zero", frozenSha256: digest(regression) },
        repair: { frozenIntegrity: true, productionChangedFiles: ["src/divide.ts"] }, suiteComparison: { baseline: { failed: [] }, postPatch: { failed: [] }, state: "CLEAN", newBackgroundFailures: [] } } },
  };
  savePatch();
  remote = { calls: [], upstream: repository(upstreamName, 11, 10), fork: repository("publisher/project", 33, user.id, true), refs: null, prs: [], owned: [], baseMissing: 0, waitCalls: [], onRequest: undefined, assertCalls: 0 };
  const request = async (repositoryName, endpoint, method = "GET", body, allowMissing = false) => {
    const call = { repository: repositoryName, endpoint, method, body, allowMissing };
    remote.calls.push(call);
    const override = await remote.onRequest?.(call);
    if (override !== undefined) return override;
    if (repositoryName === null) {
      if (endpoint === "/user") return user;
      if (endpoint.startsWith("/user/repos?")) return remote.owned;
      assert.fail(`Unexpected root endpoint ${endpoint}`);
    }
    if (endpoint === "") return repositoryName === upstreamName ? remote.upstream : remote.fork?.full_name === repositoryName ? remote.fork : null;
    if (repositoryName === upstreamName && endpoint.startsWith("/branches/")) return { name: source.bundle.details.source.targetBranch, commit: { sha: remote.advancedBase ?? baseCommit } };
    if (repositoryName === upstreamName && endpoint.startsWith("/pulls?")) {
      assert.match(endpoint, /head=publisher%3Apatchverdict%2Fmission-fork/);
      return remote.prs;
    }
    if (endpoint.startsWith("/git/commits/") && method === "GET") {
      const sha = endpoint.split("/").at(-1);
      if (repositoryName !== upstreamName && sha === baseCommit && remote.baseMissing-- > 0) return null;
      return commitInfo(sha);
    }
    if (endpoint.startsWith("/git/trees/") && method === "GET") {
      const sha = endpoint.split("/").at(-1).split("?")[0];
      const tree = git(["ls-tree", "-r", "-t", "-z", sha]).toString().split("\0").filter(Boolean).map(line => {
        const [, mode, type, sha, file] = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line);
        return { mode, type, sha, path: file };
      });
      return { sha, tree, truncated: false };
    }
    if (endpoint.startsWith("/git/blobs/") && method === "GET") {
      const sha = endpoint.split("/").at(-1);
      return { sha, encoding: "base64", content: git(["cat-file", "blob", sha]).toString("base64") };
    }
    if (endpoint.startsWith("/git/ref/heads/") && method === "GET") return remote.refs ? { ref: "refs/heads/" + source.branch, object: { type: "commit", sha: remote.refs } } : null;
    if (endpoint === "/forks" && method === "POST") {
      assert.equal(repositoryName, upstreamName);
      assert.deepEqual(body, { default_branch_only: false });
      return remote.fork = repository("publisher/project", 33, user.id, true);
    }
    if (method === "POST" && endpoint.startsWith("/git/")) assert.equal(repositoryName, remote.fork.full_name, "Git writes must target only the validated user fork");
    if (endpoint === "/git/blobs" && method === "POST") return { sha: git(["hash-object", "-w", "--stdin"], Buffer.from(body.content, "base64")).toString().trim() };
    if (endpoint === "/git/trees" && method === "POST") {
      assert.equal(body.base_tree, baseTree);
      git(["read-tree", body.base_tree]);
      for (const item of body.tree) git(["update-index", "--add", "--cacheinfo", `${item.mode},${item.sha},${item.path}`]);
      return { sha: git(["write-tree"]).toString().trim() };
    }
    if (endpoint === "/git/commits" && method === "POST") return commitInfo(createCommit(body));
    if (endpoint === "/git/refs" && method === "POST") { remote.refs = body.sha; return { ref: body.ref, object: { sha: body.sha, type: "commit" } }; }
    if (endpoint === "/pulls" && method === "POST") {
      assert.equal(repositoryName, upstreamName);
      assert.equal(body.head, "publisher:" + source.branch);
      assert.equal(body.base, source.bundle.details.source.targetBranch);
      assert.equal(body.head_repo, remote.fork.name);
      const pr = existingPr(remote.refs);
      remote.prs.push(pr);
      return pr;
    }
    assert.fail(`Unexpected endpoint ${repositoryName} ${method} ${endpoint}`);
  };
  clients = { root: (...args) => request(null, ...args), repository: name => (...args) => request(name, ...args),
    assertUnchanged: async () => { remote.assertCalls++; }, title: "fix: Division by zero",
    description: defaultBranch => pullRequestDescription(source.bundle, defaultBranch), wait: async ms => { remote.waitCalls.push(ms); } };
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  process.chdir(originalCwd);
  if (originalToken === undefined) delete process.env.PATCHVERDICT_GITHUB_TOKEN;
  else process.env.PATCHVERDICT_GITHUB_TOKEN = originalToken;
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  assert.equal(path.dirname(directory), testsDirectory);
  assert.ok(path.basename(directory).startsWith(".fork-publication-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function integrationFixture({ background = false } = {}) {
  const missionId = source.bundle.details.id;
  const bundleDirectory = path.join(directory, "output", missionId);
  await mkdir(path.join(bundleDirectory, "evidence"), { recursive: true });
  await mkdir(path.join(directory, "src"));
  await writeFile(path.join(directory, "package.json"), JSON.stringify({ name: "patch-verdict" }));
  await writeFile(path.join(directory, "src", "real-mission-demo.ts"), "// integration fixture root");
  const fixture = proofV3Fixture({ missionId, background });
  const proof = fixture.proof;
  proof.createdAt = "2026-10-01T12:34:56.000Z";
  proof.mission.source = { ...source.bundle.details.source, githubIssue: { ...source.bundle.details.source.githubIssue, url: `https://github.com/${upstreamName}/issues/123`, body: "Return zero instead of Infinity." } };
  proof.mission.issue = `${proof.mission.source.githubIssue.title}\n\n${proof.mission.source.githubIssue.body}`;
  proof.patch = { applied: true, baseCommit: source.baseCommit, changedFiles: source.bundle.mission.patch.changedFiles, sha256: source.patchSha256 };
  proof.frozenReproduction.baseCommit = source.baseCommit;
  proof.frozenReproduction.frozenSha256 = digest(regression);
  const events = [{ timestamp: "2026-10-01T12:34:56.000Z", state: "COMPLETED", message: "Mission completed with verified evidence" }];
  const artifacts = {
    "proof.json": JSON.stringify(proof), "events.json": JSON.stringify(events), "patch.diff": source.patch,
    "evidence/baseline-test.json": JSON.stringify(fixture.baseline), "evidence/post-patch-test.json": JSON.stringify(fixture.postPatch), "evidence/full-suite.json": JSON.stringify(fixture.fullSuite),
  };
  for (const [file, content] of Object.entries(artifacts)) await writeFile(path.join(bundleDirectory, file), content);
  process.chdir(directory);
  process.env.PATCHVERDICT_GITHUB_TOKEN = token;
  process.env.OPENAI_API_KEY = "unrelated-ai-key-never-inherit";
  source.bundle = await loadProofBundle(missionId);
  source.proofSha256 = digest(artifacts["proof.json"]);
  source.draft = source.bundle.mission.verdict === "REVIEW_REQUIRED";
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api.github.com");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    const method = options.method;
    const body = options.body ? JSON.parse(options.body) : undefined;
    const repo = /^\/repos\/([^/]+)\/([^/]+)(.*)$/.exec(parsed.pathname);
    const value = repo
      ? await clients.repository(`${decodeURIComponent(repo[1])}/${decodeURIComponent(repo[2])}`)(repo[3] + parsed.search, method, body, true)
      : await clients.root(parsed.pathname + parsed.search, method, body, true);
    return value === null ? new Response(null, { status: 404 }) : value instanceof Response ? value : Response.json(value);
  };
  return { missionId, bundleDirectory, proof, artifacts };
}

test("strict Create route reloads proof, strips credentials from Git, persists separate metadata, and revalidates repeated clicks", async t => {
  const fixture = await integrationFixture();
  const context = { params: Promise.resolve({ missionId: fixture.missionId }) };
  const url = `http://localhost/api/missions/${fixture.missionId}/pull-request`;
  const originalSpawn = childProcess.spawn;
  const spy = t.mock.method(childProcess, "spawn", (command, args, options) => {
    assert.equal(command, "git", "Publication must not run AI or repository code");
    assert.equal(options.shell, false);
    assert.equal(options.env.PATCHVERDICT_GITHUB_TOKEN, undefined);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    assert.equal(args.join(" ").includes(token), false);
    return originalSpawn(command, args, options);
  });
  syncBuiltinESMExports();
  try {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost" } }), context);
    assert.equal(response.status, 200, await response.clone().text());
    const result = await response.json();
    assert.deepEqual(Object.keys(result).sort(), ["draft", "number", "url"]);
    assert.equal(result.draft, false);
    assert.ok(spy.mock.calls.length > 0);
    const saved = JSON.parse(await readFile(path.join(fixture.bundleDirectory, "pull-request.json"), "utf8"));
    assert.equal(saved.publicationMode, "FORK");
    assert.equal(saved.targetBranch, "release/2.x");
    assert.equal(saved.forkRepository, "publisher/project");
    assert.equal(saved.proofSha256, digest(fixture.artifacts["proof.json"]));
    assert.equal(saved.patchSha256, digest(fixture.artifacts["patch.diff"]));
    const callCount = remote.calls.length;
    assert.deepEqual(await createMissionPullRequest(fixture.missionId), result);
    assert.ok(remote.calls.length > callCount, "Repeated strict actions must validate remote state even with saved metadata");
    assert.equal(posts("/pulls").length, 1);
    assert.deepEqual(await readMissionPullRequest(fixture.missionId), result);
    for (const [file, bytes] of Object.entries(fixture.artifacts)) assert.deepEqual(await readFile(path.join(fixture.bundleDirectory, file)), Buffer.from(bytes));
    const files = await readdir(fixture.bundleDirectory);
    assert.ok(!files.some(file => file.endsWith(".tmp") || file.endsWith(".lock")));
    assert.equal(JSON.stringify(saved).includes(token), false);
    delete process.env.PATCHVERDICT_GITHUB_TOKEN;
    assert.deepEqual(await readMissionPullRequest(fixture.missionId), result);
    await assert.rejects(createMissionPullRequest(fixture.missionId), { status: 503 });
  } finally { spy.mock.restore(); syncBuiltinESMExports(); }
});

test("strict canonical proof accepts unchanged background failures as draft and denies conflicting evidence before GitHub", async () => {
  const fixture = await integrationFixture({ background: true });
  assert.equal((await createMissionPullRequest(fixture.missionId)).draft, true);
  assert.equal(posts("/pulls")[0].body.draft, true);
  const before = remote.calls.length;
  fixture.proof.targetAfter.failed = fixture.proof.frozenReproduction.targetBaselineResult.failed;
  await writeFile(path.join(fixture.bundleDirectory, "proof.json"), JSON.stringify(fixture.proof));
  await assert.rejects(createMissionPullRequest(fixture.missionId), { status: 409 });
  assert.equal(remote.calls.length, before);
});

test("strict local persistence failure recovers the existing upstream PR without another publication", async () => {
  const fixture = await integrationFixture();
  remote.onRequest = async call => {
    if (call.endpoint === "/pulls" && call.method === "POST") await mkdir(path.join(fixture.bundleDirectory, "pull-request.json"));
  };
  await assert.rejects(createMissionPullRequest(fixture.missionId), /local record could not be saved/);
  assert.equal(posts("/pulls").length, 1);
  const obstruction = path.resolve(fixture.bundleDirectory, "pull-request.json");
  assert.equal(path.dirname(obstruction), path.resolve(fixture.bundleDirectory));
  await rm(obstruction, { recursive: true });
  remote.onRequest = undefined;
  assert.equal((await createMissionPullRequest(fixture.missionId)).number, 9);
  assert.equal(posts("/pulls").length, 1);
  assert.equal(posts("/git/commits").length, 1);
  assert.deepEqual(await readFile(path.join(fixture.bundleDirectory, "proof.json")), Buffer.from(fixture.artifacts["proof.json"]));
});

test("strict metadata forgery cannot select fork/base and a newly mutated proof stops before opening a PR", async () => {
  const fixture = await integrationFixture();
  await createMissionPullRequest(fixture.missionId);
  const location = path.join(fixture.bundleDirectory, "pull-request.json");
  const saved = JSON.parse(await readFile(location, "utf8"));
  for (const override of [{ targetBranch: "main" }, { forkOwner: "attacker", forkRepository: "attacker/other" }, { publicationMode: "DIRECT" }, { proofSha256: "0".repeat(64) }]) {
    await writeFile(location, JSON.stringify({ ...saved, ...override }));
    if (!override.forkOwner) assert.equal(await readMissionPullRequest(fixture.missionId), null);
    const result = await createMissionPullRequest(fixture.missionId);
    assert.equal(result.number, 9);
    assert.equal(JSON.parse(await readFile(location, "utf8")).forkRepository, "publisher/project");
  }
  assert.equal(posts("/pulls").length, 1);
  // A fresh canonical action must re-read proof after remote object preparation.
  remote.prs = []; remote.refs = null;
  await rm(location);
  remote.onRequest = async call => {
    if (call.endpoint === "/git/refs" && call.method === "POST") {
      fixture.proof.createdAt = "2026-10-01T12:34:57.000Z";
      await writeFile(path.join(fixture.bundleDirectory, "proof.json"), JSON.stringify(fixture.proof));
    }
  };
  await assert.rejects(createMissionPullRequest(fixture.missionId), /artifacts changed/);
  assert.equal(posts("/pulls").length, 1);
});

test("strict route rejects browser canonical overrides and sanitizes HTTP token/permission failures", async () => {
  const fixture = await integrationFixture();
  const context = { params: Promise.resolve({ missionId: fixture.missionId }) };
  const url = `http://localhost/api/missions/${fixture.missionId}/pull-request`;
  const forged = await POST(new Request(url, { method: "POST", body: JSON.stringify({ forkOwner: "attacker", baseCommit: "0".repeat(40), targetBranch: "main" }) }), context);
  assert.equal(forged.status, 400);
  assert.equal(remote.calls.length, 0);
  for (const [status, headers, expected] of [[403, {}, 403], [403, { "x-ratelimit-remaining": "0" }, 429], [429, {}, 429]]) {
    remote.onRequest = () => new Response(`${token} C:\\private\\file sensitive API response`, { status, headers });
    const response = await POST(new Request(url, { method: "POST" }), context);
    assert.equal(response.status, expected);
    const result = await response.json();
    assert.doesNotMatch(result.error, /fork-integration-token|private|sensitive/);
  }
  assert.equal(posts().length, 0);
  assert.deepEqual(await readFile(path.join(fixture.bundleDirectory, "proof.json")), Buffer.from(fixture.artifacts["proof.json"]));
});

test("publication timestamp comes only from immutable proof bytes, not mutable event timestamps", async () => {
  const fixture = await integrationFixture();
  const first = await createMissionPullRequest(fixture.missionId);
  const metadataFile = path.join(fixture.bundleDirectory, "pull-request.json");
  const head = JSON.parse(await readFile(metadataFile, "utf8")).headSha;
  await writeFile(path.join(fixture.bundleDirectory, "events.json"), JSON.stringify([{ timestamp: "2030-01-01T00:00:00.000Z", state: "COMPLETED", message: "Same proof, changed display timestamp" }]));
  assert.deepEqual(await createMissionPullRequest(fixture.missionId), first);
  assert.equal(JSON.parse(await readFile(metadataFile, "utf8")).headSha, head);
  assert.equal(posts("/git/commits").length, 1);
  assert.equal(posts("/pulls").length, 1);
  assert.equal(posts("/git/commits")[0].body.author.date, "2026-10-01T12:34:56Z");
  delete fixture.proof.createdAt;
  await writeFile(path.join(fixture.bundleDirectory, "proof.json"), JSON.stringify(fixture.proof));
  assert.equal((await loadProofBundle(fixture.missionId)).mission.verdict, "VERIFIED");
  const calls = remote.calls.length;
  await assert.rejects(createMissionPullRequest(fixture.missionId), /timestamp/);
  assert.equal(remote.calls.length, calls);
});

test("exact verified tree is published only through authenticated fork to the recorded maintenance branch", async () => {
  const before = JSON.stringify(source.bundle);
  const result = await publishFork(source, clients);
  assert.equal(result.publicationMode, "FORK");
  assert.equal(result.forkRepository, "publisher/project");
  assert.equal(result.targetBranch, "release/2.x");
  assert.equal(result.baseCommit, source.baseCommit);
  assert.equal(result.treeSha, patchedTree);
  assert.equal(result.headSha, forkCommitPlan(source, patchedTree, clients.title).sha);
  assert.deepEqual(commitInfo(result.headSha).parents, [{ sha: source.baseCommit }]);
  assert.equal(git(["show", `${result.headSha}:src/divide.ts`]).toString(), repaired);
  assert.equal(JSON.stringify(source.bundle), before);
  assert.match(posts("/pulls")[0].body.body, /Related to #123/);
  assert.doesNotMatch(posts("/pulls")[0].body.body, /Fixes #123/);
  assert.equal(posts("/forks").length, 0);
});

test("default main/master branches use Fixes while weird valid branch text remains opaque API data", async () => {
  for (const branch of ["main", "master", "release/$topic;echo"]) {
    remote.prs = []; remote.refs = null;
    source.bundle.details.source.targetBranch = branch;
    remote.upstream.default_branch = branch === "master" ? "master" : "main";
    await publishFork(source, clients);
    const body = posts("/pulls").at(-1).body;
    assert.equal(body.base, branch);
    assert.match(body.body, branch.startsWith("release") ? /Related to #123/ : /Fixes #123/);
  }
});

test("branch advancement never changes exact commit parent and deleted target fails before writes", async () => {
  remote.advancedBase = git(["commit-tree", baseTree, "-p", source.baseCommit], "Advanced\n").toString().trim();
  await publishFork(source, clients);
  assert.deepEqual(posts("/git/commits")[0].body.parents, [source.baseCommit]);
  remote.calls = []; remote.prs = []; remote.refs = null;
  remote.onRequest = call => call.endpoint.startsWith("/branches/") ? null : undefined;
  await assert.rejects(publishFork(source, clients), /no longer exists/);
  assert.equal(posts().length, 0);
});

test("missing fork is created once and async exact-base readiness is bounded", async () => {
  remote.fork = null;
  remote.baseMissing = 2;
  await publishFork(source, clients);
  assert.equal(posts("/forks").length, 1);
  assert.deepEqual(remote.waitCalls, [500, 1000]);
  await publishFork(source, clients);
  assert.equal(posts("/forks").length, 1);
  assert.equal(posts("/pulls").length, 1);
});

test("fork missing exact base fails without mutating its default branch and retry reuses the fork", async () => {
  remote.baseMissing = 6;
  await assert.rejects(publishFork(source, clients), { status: 503 });
  assert.equal(remote.waitCalls.length, 5);
  assert.equal(posts().length, 0);
  await publishFork(source, clients);
  assert.equal(posts("/forks").length, 0);
  assert.equal(posts("/pulls").length, 1);
  assert.ok(remote.calls.every(call => !["PATCH", "DELETE"].includes(call.method) && !call.endpoint.includes("merge-upstream")));
});

test("renamed fork is discovered by verified ownership and relation; wrong same-name repository is rejected", async () => {
  remote.fork = repository("publisher/renamed-project", 33, user.id, true);
  remote.owned = [remote.fork];
  assert.equal((await publishFork(source, clients)).forkRepository, "publisher/renamed-project");
  remote.prs = []; remote.calls = [];
  remote.fork = repository("publisher/project", 44, user.id, false);
  await assert.rejects(publishFork(source, clients), /not an authenticated-user fork/);
  assert.equal(posts().length, 0);
});

test("wrong parent relation, forged user identity, and incomplete fork discovery fail closed", async () => {
  remote.fork.parent.id = 999; remote.fork.source.id = 999;
  await assert.rejects(publishFork(source, clients), /fork relation/);
  remote.onRequest = call => call.endpoint === "/user" ? { ...user, type: "Organization" } : undefined;
  await assert.rejects(publishFork(source, clients), /authenticated GitHub user/);
  remote.onRequest = undefined; remote.fork = null;
  remote.owned = Array.from({ length: 100 }, (_, i) => ({ id: i, fork: false }));
  await assert.rejects(publishFork(source, clients), /search was incomplete/);
  assert.equal(posts().length, 0);
});

test("combined generated regression and production bytes publish exactly as a draft", async () => {
  put("src/generated.test.ts", regression);
  source.bundle.mission.frozenReproduction = { ...source.bundle.mission.frozenReproduction, origin: "GENERATED_REGRESSION", testPath: "src/generated.test.ts" };
  source.bundle.mission.verdict = "REVIEW_REQUIRED";
  source.draft = true;
  savePatch();
  const result = await publishFork(source, clients);
  assert.equal(result.draft, true);
  assert.equal(git(["show", `${result.headSha}:src/generated.test.ts`]).toString(), regression);
  assert.equal(git(["show", `${result.headSha}:src/divide.ts`]).toString(), repaired);
  assert.match(posts("/pulls")[0].body.body, /AI-generated/);
  assert.equal(posts("/git/blobs").length, 2);
});

test("frozen existing/generated file digest mismatch is rejected before remote writes", async () => {
  source.bundle.mission.frozenReproduction.frozenSha256 = "0".repeat(64);
  await assert.rejects(publishFork(source, clients), /frozen test digest/);
  put("src/generated.test.ts", regression); savePatch();
  source.bundle.mission.frozenReproduction.origin = "GENERATED_REGRESSION";
  source.bundle.mission.frozenReproduction.testPath = "src/generated.test.ts";
  await assert.rejects(publishFork(source, clients), /published regression differs/);
  assert.equal(posts().length, 0);
});

test("existing exact deterministic branch is reused; different commit with same tree/parent is a conflict", async () => {
  remote.refs = git(["commit-tree", patchedTree, "-p", source.baseCommit], "Other proof\n").toString().trim();
  await assert.rejects(publishFork(source, clients), /conflicting commit/);
  assert.equal(posts().length, 0);
  const plan = forkCommitPlan(source, patchedTree, clients.title);
  remote.refs = createCommit(plan.body);
  await publishFork(source, clients);
  assert.equal(posts("/git/commits").length, 0);
  assert.equal(posts("/git/refs").length, 0);
  assert.equal(posts("/pulls").length, 1);
});

test("closed exact PR recovers after deterministic branch deletion without any writes", async () => {
  const plan = forkCommitPlan(source, patchedTree, clients.title);
  remote.prs = [existingPr(createCommit(plan.body), { state: "closed" })];
  const result = await publishFork(source, clients);
  assert.equal(result.number, 9);
  assert.equal(remote.refs, null);
  assert.equal(posts().length, 0);
});

test("recovered PR rejects wrong target branch, head repository, draft policy, or proof-bound commit", async () => {
  const plan = forkCommitPlan(source, patchedTree, clients.title);
  const sha = createCommit(plan.body);
  for (const mutate of [
    pr => { pr.base.ref = "main"; }, pr => { pr.head.repo = { ...remote.fork, id: 999 }; },
    pr => { pr.draft = true; }, pr => { pr.head.sha = source.baseCommit; },
  ]) {
    const pr = existingPr(sha); mutate(pr); remote.prs = [pr];
    await assert.rejects(publishFork(source, clients), /conflict/);
  }
  assert.equal(posts().length, 0);
});

test("uncertain deterministic commit and PR responses recover existing objects instead of duplication", async () => {
  remote.onRequest = call => {
    if (call.endpoint === "/git/commits" && call.method === "POST") { createCommit(call.body); throw new Error("lost response"); }
    if (call.endpoint === "/pulls" && call.method === "POST") { remote.prs.push(existingPr(remote.refs)); throw new Error("lost response"); }
  };
  assert.equal((await publishFork(source, clients)).number, 9);
  await publishFork(source, clients);
  assert.equal(posts("/git/commits").length, 1);
  assert.equal(posts("/git/refs").length, 1);
  assert.equal(posts("/pulls").length, 1);
});

test("uncertain fork creation response recovers the created related fork", async () => {
  remote.fork = null;
  remote.onRequest = call => {
    if (call.endpoint === "/forks" && call.method === "POST") { remote.fork = repository("publisher/project", 33, user.id, true); throw new Error("lost create response"); }
  };
  assert.equal((await publishFork(source, clients)).number, 9);
  assert.equal(posts("/forks").length, 1);
});

test("proof mutation before ref creation stops before any branch or PR write", async () => {
  clients.assertUnchanged = async () => { if (++remote.assertCalls > 1) throw new PullRequestError("The mission artifacts changed during publication."); };
  await assert.rejects(publishFork(source, clients), /artifacts changed/);
  assert.equal(posts("/git/refs").length, 0);
  assert.equal(posts("/pulls").length, 0);
});

test("malicious created blob/tree/ref responses cannot open a PR", async () => {
  remote.onRequest = call => call.endpoint === "/git/blobs" && call.method === "POST" ? { sha: "0".repeat(40) } : undefined;
  await assert.rejects(publishFork(source, clients), /different patch bytes/);
  remote.onRequest = call => call.endpoint === "/git/trees" && call.method === "POST" ? { sha: "0".repeat(40) } : undefined;
  await assert.rejects(publishFork(source, clients), /different verified tree/);
  remote.onRequest = call => call.endpoint.startsWith("/git/ref/heads/") ? { ref: "refs/heads/unrelated", object: { type: "commit", sha: source.baseCommit } } : undefined;
  await assert.rejects(publishFork(source, clients), /unexpected publication branch/);
  assert.equal(posts("/pulls").length, 0);
});

test("shared API permission/rate-limit failures stop without changing proof or publishing", async () => {
  const before = JSON.stringify(source);
  for (const status of [403, 429]) {
    remote.onRequest = () => { throw new PullRequestError("GitHub access is unavailable.", status); };
    await assert.rejects(publishFork(source, clients), { status });
  }
  assert.equal(JSON.stringify(source), before);
  assert.equal(posts().length, 0);
});
