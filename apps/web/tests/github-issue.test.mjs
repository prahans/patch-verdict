import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { registerHooks } from "node:module";
import path from "node:path";

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {};", shortCircuit: true };
  return nextResolve(specifier.startsWith(".") && !path.extname(specifier) ? specifier + ".ts" : specifier, context);
} });
const { parseGitHubIssueUrl, parseGitHubRepositoryUrl, parsePersistedGitHubIssue } = await import("../lib/github-issue-url.ts");
const { parseMissionInput, parseBackendMissionInput } = await import("../lib/mission-input.ts");
const { resolveGitHubIssue, resolveMissionInput } = await import("../lib/github-issue.ts");
const { GET } = await import("../app/api/github/issue/route.ts");
const originalFetch = globalThis.fetch;
const originalToken = process.env.PATCHVERDICT_GITHUB_TOKEN;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.PATCHVERDICT_GITHUB_TOKEN;
  else process.env.PATCHVERDICT_GITHUB_TOKEN = originalToken;
});
const repositoryUrl = "https://github.com/owner/repository";
const issueUrl = `${repositoryUrl}/issues/12`;
const issueData = { number: 12, title: "Divide by zero", body: "Return zero when the divisor is zero." };
const response = (value = issueData, init) => Response.json(value, init);
const previewRequest = (url = issueUrl) => new Request(`http://localhost/api/github/issue?url=${encodeURIComponent(url)}`);

test("exact issue parser returns canonical repository and positive issue number", () => {
  assert.deepEqual(parseGitHubIssueUrl(issueUrl), { owner: "owner", repository: "repository", repositoryUrl, issueNumber: 12, issueUrl });
  assert.equal(parseGitHubRepositoryUrl("HTTPS://GITHUB.COM/owner/.github/").repository, ".github");
  assert.equal(parseGitHubRepositoryUrl(`${repositoryUrl}.git`).repositoryUrl, repositoryUrl);
});

test("issue parser rejects non-issue URLs and all ambiguous URL components", () => {
  for (const url of [repositoryUrl, `${repositoryUrl}/issues`, `${repositoryUrl}/pulls/12`, `${repositoryUrl}/pull/12`,
    issueUrl.replace("https:", "http:"), issueUrl.replace("github.com", "gitlab.com"),
    issueUrl.replace("github.com", "github.com.evil"), issueUrl.replace("github.com", "user:secret@github.com"),
    issueUrl.replace("github.com", "github.com:443"), `${issueUrl}?foo=bar`, `${issueUrl}?`, `${issueUrl}#comment`, `${issueUrl}#`,
    `${issueUrl}/extra`, `${issueUrl}/`, `${repositoryUrl}/issues/0`, `${repositoryUrl}/issues/-1`,
    `${repositoryUrl}/issues/1.2`, `${repositoryUrl}/issues/no`, `${repositoryUrl}/issues/01`,
    `${repositoryUrl}/issues/9007199254740992`, "https://github.com/owner/../issues/12", "https://github.com/owner/%2erepo/issues/12",
    "https://github.com/own\ner/repository/issues/12", "https://github.com\\owner\\repository\\issues\\12"]) {
    assert.throws(() => parseGitHubIssueUrl(url), undefined, url);
  }
});

test("public resolution uses fixed API origin, safe headers and no write token", async () => {
  for (const token of [undefined, "SERVER_ONLY_SECRET"]) {
    if (token) process.env.PATCHVERDICT_GITHUB_TOKEN = token;
    else delete process.env.PATCHVERDICT_GITHUB_TOKEN;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.github.com/repos/owner/repository/issues/12");
      assert.equal(options.redirect, "error");
      assert.equal(options.cache, "no-store");
      assert.ok(options.headers.Accept);
      assert.ok(options.headers["User-Agent"]);
      assert.equal(new Headers(options.headers).has("Authorization"), false);
      assert.doesNotMatch(JSON.stringify(options), /SERVER_ONLY_SECRET/);
      return response();
    };
    const result = await resolveGitHubIssue(issueUrl);
    assert.deepEqual(result, { url: issueUrl, number: 12, title: issueData.title, body: issueData.body, owner: "owner", repository: "repository" });
  }
});

test("empty issue body uses a usable title even below manual minimum length", async () => {
  globalThis.fetch = async () => response({ ...issueData, title: "Fix divide", body: null });
  const input = await resolveMissionInput({ mode: "issue", issueUrl });
  assert.equal(input.issue, "Fix divide");
  assert.equal(input.githubIssue.body, "");
  assert.equal(parseBackendMissionInput(input).issue, "Fix divide");
  assert.throws(() => parseMissionInput({ mode: "manual", repositoryUrl, issue: "Fix divide" }), /at least 20/);
});

test("fresh canonical mission resolution discards forged browser fields and keeps advanced settings", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ ...issueData, title: `Canonical ${calls}` }); };
  await GET(previewRequest());
  const input = await resolveMissionInput({ mode: "issue", issueUrl, repositoryUrl: "https://github.com/evil/repo",
    issue: "forged context", title: "forged title", body: "forged body", githubIssue: { number: 99 },
    reproductionCommand: " npm test -- divide ", requiredOutput: " expected zero " });
  assert.equal(calls, 2);
  assert.equal(input.repositoryUrl, repositoryUrl);
  assert.equal(input.issue, `Canonical 2\n\n${issueData.body}`);
  assert.equal(input.githubIssue.title, "Canonical 2");
  assert.equal(input.reproductionCommand, "npm test -- divide");
  assert.equal(input.requiredOutput, "expected zero");
});

test("manual mode preserves validation and advanced settings and ignores forged issue metadata", async () => {
  globalThis.fetch = () => assert.fail("manual mode must not fetch GitHub");
  const input = await resolveMissionInput({ mode: "manual", repositoryUrl, issue: "The result should be zero on divide by zero.",
    reproductionCommand: "npm test", requiredOutput: "expected zero", githubIssue: { title: "forged" } });
  assert.equal(input.githubIssue, undefined);
  assert.equal(input.reproductionCommand, "npm test");
  assert.equal(input.requiredOutput, "expected zero");
  assert.throws(() => parseMissionInput({ mode: "manual", repositoryUrl, issue: "too short" }));
  assert.throws(() => parseMissionInput({ mode: "manual", repositoryUrl: `${repositoryUrl}?token=x`, issue: input.issue }));
  assert.throws(() => parseMissionInput({ mode: "anything", repositoryUrl, issue: input.issue }));
});

test("preview returns only bounded plain text fields", async () => {
  globalThis.fetch = async () => response({ ...issueData, body: "<script>alert(1)</script>" + "x".repeat(1000), extra: "secret" });
  const result = await GET(previewRequest());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("Cache-Control"), "no-store");
  const data = await result.json();
  assert.deepEqual(Object.keys(data).sort(), ["bodyPreview", "issueNumber", "issueUrl", "owner", "repository", "title"]);
  assert.equal(data.bodyPreview.length, 500);
  assert.match(data.bodyPreview, /^<script>/); // React renders this as text.
});

test("invalid URLs never reach GitHub", async () => {
  globalThis.fetch = () => assert.fail("invalid URL must fail before fetch");
  const result = await GET(previewRequest("http://127.0.0.1/private"));
  assert.equal(result.status, 400);
  await assert.rejects(resolveMissionInput({ mode: "issue", issueUrl: repositoryUrl }));
});

test("GitHub errors are safe, bounded and classified", async () => {
  for (const [status, headers, expected, message] of [
    [404, {}, 404, /not found|private/], [401, {}, 404, /inaccessible/], [403, {}, 403, /inaccessible/],
    [403, { "x-ratelimit-remaining": "0" }, 429, /rate limit/], [429, {}, 429, /rate limit/], [500, {}, 502, /unavailable/],
  ]) {
    globalThis.fetch = async () => new Response("SECRET_TOKEN filesystem /private/path " + "x".repeat(10000), { status, headers });
    const result = await GET(previewRequest());
    assert.equal(result.status, expected);
    const data = await result.json();
    assert.match(data.error, message);
    assert.ok(data.error.length < 200);
    assert.doesNotMatch(data.error, /SECRET_TOKEN|private\/path/);
  }
  globalThis.fetch = async () => { throw new Error("SECRET_TOKEN /private/path"); };
  assert.equal((await GET(previewRequest())).status, 502);
});

test("pull requests, malformed API data and oversized bodies cannot become mission context", async () => {
  for (const value of [{ ...issueData, pull_request: {} }, { ...issueData, pull_request: null }]) {
    globalThis.fetch = async () => response(value);
    await assert.rejects(resolveGitHubIssue(issueUrl), /pull request/);
  }
  for (const value of [null, [], { ...issueData, number: 13 }, { ...issueData, title: "" },
    { ...issueData, title: "evil\nheading" }, { ...issueData, title: "x".repeat(1025) },
    { ...issueData, body: 42 }, { ...issueData, body: "bad\0body" }]) {
    globalThis.fetch = async () => response(value);
    await assert.rejects(resolveGitHubIssue(issueUrl), /unavailable/);
  }
  globalThis.fetch = async () => response({ ...issueData, body: "x".repeat(10001) });
  assert.equal((await GET(previewRequest())).status, 422);
  globalThis.fetch = async () => new Response("x".repeat(256 * 1024 + 1));
  await assert.rejects(resolveGitHubIssue(issueUrl), /unavailable/);
});

test("persisted source validation rejects forged links, repositories and fields", () => {
  const value = { url: issueUrl, number: 12, title: "Canonical title", owner: "owner", repository: "repository", body: "" };
  assert.deepEqual(parsePersistedGitHubIssue(value, repositoryUrl), value);
  for (const changed of [{ ...value, url: "javascript:alert(1)" }, { ...value, number: 13 }, { ...value, owner: "other" },
    { ...value, title: "\0bad" }, { ...value, body: 42 }]) {
    assert.equal(parsePersistedGitHubIssue(changed, repositoryUrl), undefined);
  }
  assert.equal(parsePersistedGitHubIssue(value, "https://github.com/other/repo"), undefined);
  assert.throws(() => parseBackendMissionInput({ repositoryUrl, issue: "forged issue", githubIssue: value }));
});

test("serialized issue metadata is bounded before it reaches a Windows process environment", async () => {
  const body = "\u0001".repeat(9000);
  const githubIssue = { url: issueUrl, number: 12, title: issueData.title, owner: "owner", repository: "repository", body };
  const issue = `${githubIssue.title}\n\n${body}`;
  assert.ok(issue.length < 10000);
  assert.ok(JSON.stringify(githubIssue).length > 24000);
  globalThis.fetch = async () => response({ ...issueData, body });
  await assert.rejects(resolveMissionInput({ mode: "issue", issueUrl }), /too large for the mission runner/);
  assert.throws(() => parseBackendMissionInput({ repositoryUrl, issue, githubIssue }), /too large for the mission runner/);

  const ordinaryBody = "Steps:\n\tDivide by zero.\nExpected:\n\tReturn zero.";
  globalThis.fetch = async () => response({ ...issueData, body: ordinaryBody });
  const input = await resolveMissionInput({ mode: "issue", issueUrl });
  assert.equal(input.githubIssue.body, ordinaryBody);
  assert.equal(parseBackendMissionInput(input).issue, `${issueData.title}\n\n${ordinaryBody}`);
});
