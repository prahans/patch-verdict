import assert from "node:assert/strict";
import { beforeEach, afterEach, test } from "node:test";
import { registerHooks } from "node:module";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({ resolve(specifier, context, next) {
  return specifier === "server-only" ? { url: "data:text/javascript,export {};", shortCircuit: true }
    : next(specifier.startsWith(".") && !path.extname(specifier) ? specifier + ".ts" : specifier, context);
} });
const { publishFork, forkCommitPlan } = await import("../lib/github-fork-publication.ts");
const { pullRequestDescription } = await import("../lib/github-pull-request.ts");
const { PullRequestError } = await import("../lib/exact-verified-patch.ts");
const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
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
    directory, repository: upstreamName, owner: "upstream", name: "project", baseCommit, proofSha256: "b".repeat(64), patchSha256: "", patch: Buffer.alloc(0), branch: "patchverdict/mission-fork", draft: false,
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
  assert.equal(path.dirname(directory), testsDirectory);
  assert.ok(path.basename(directory).startsWith(".fork-publication-"));
  await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
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
