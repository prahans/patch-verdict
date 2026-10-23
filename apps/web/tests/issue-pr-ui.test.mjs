import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./helpers/ui-loader.mjs";
import { createHarness, deferred, navigation, nodes, settle, textContent } from "./helpers/ui-harness.mjs";

const { MissionLauncher } = await import("../components/landing/mission-launcher.tsx");
const { MissionLauncher: InteractiveLauncher } = await import("../components/landing/mission-launcher.tsx?interactive");
const { IssuePreview, readIssuePreview } = await import("../components/landing/issue-preview.tsx");
const { MissionSummary } = await import("../components/mission/mission-summary.tsx");
const { LiveMission } = await import("../components/mission/live-mission.tsx");
const { PullRequestAction } = await import("../components/mission/pull-request-action.tsx?interactive");

const issueUrl = "https://github.com/owner/repository/issues/12";
const repositoryUrl = "https://github.com/owner/repository";
const preview = { owner: "owner", repository: "repository", issueNumber: 12, issueUrl, title: "Division by zero returns Infinity", bodyPreview: "Return zero when the denominator is zero." };
const githubIssue = { owner: "owner", repository: "repository", number: 12, url: issueUrl, title: preview.title, body: preview.bodyPreview };
const baseCommit = "a".repeat(40);
const mission = {
  status: "COMPLETED", verdict: "VERIFIED", events: [],
  investigation: { iterations: 2 },
  patch: { applied: true, baseCommit, changedFiles: ["src/divide.ts"], diff: "diff --git a/src/divide.ts b/src/divide.ts\n", sha256: "b".repeat(64) },
};
const details = {
  id: "web-ui-test", title: "Manual mission heading", description: "Manual description remains unchanged.",
  reproduction: { label: "Reproduction", command: "npm test" }, fullSuite: { label: "Full suite", command: "npm test" },
  source: { repositoryUrl, baseCommit },
};
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const byId = (tree, id) => nodes(tree, (node) => node.props.id === id)[0];
const button = (tree, label) => nodes(tree, (node) => node.type === "button" && textContent(node).includes(label))[0];
const form = (tree) => nodes(tree, (node) => node.type === "form")[0];
const response = (value, ok = true) => ({ ok, json: async () => value });

function mockFormData(t) {
  const NativeFormData = globalThis.FormData;
  t.mock.method(globalThis, "FormData", class TestFormData extends NativeFormData {
    constructor(fields) {
      super();
      for (const [name, value] of Object.entries(fields)) this.set(name, value);
    }
  });
}

test("landing renders issue mode by default with advanced fields and no manual inputs", () => {
  const html = render(MissionLauncher);
  assert.match(html, /GitHub issue URL/);
  assert.match(html, /https:\/\/github.com\/owner\/repo\/issues\/12/);
  assert.match(html, /Paste a public GitHub issue/);
  assert.match(html, /Advanced verification settings/);
  assert.match(html, /name="reproductionCommand"/);
  assert.match(html, /name="requiredOutput"/);
  assert.doesNotMatch(html, /name="repositoryUrl"|name="issue"/);
});

test("manual fallback and return action switch only primary fields, preserving entered values", () => {
  const view = createHarness(InteractiveLauncher);
  let tree = view.render();
  byId(tree, "issue-url").props.onChange({ target: { value: issueUrl } });
  button(tree, "No GitHub issue?").props.onClick();
  tree = view.render();
  assert.equal(byId(tree, "issue-url"), undefined);
  assert.equal(byId(tree, "issue").props.minLength, 20);
  byId(tree, "repository-url").props.onChange({ target: { value: repositoryUrl } });
  byId(tree, "issue").props.onChange({ target: { value: details.description } });
  assert.ok(byId(tree, "reproduction-command"));
  assert.ok(byId(tree, "required-output"));
  button(tree, "Use a GitHub issue instead").props.onClick();
  tree = view.render();
  assert.equal(byId(tree, "issue-url").props.value, issueUrl);
  assert.equal(byId(tree, "repository-url"), undefined);
  button(tree, "No GitHub issue?").props.onClick();
  tree = view.render();
  assert.equal(byId(tree, "repository-url").props.value, repositoryUrl);
  assert.equal(byId(tree, "issue").props.value, details.description);
});

test("resolved issue preview appears after fetching and renders untrusted text without HTML", async (t) => {
  const hostile = { ...preview, title: '<script>alert("title")</script>', bodyPreview: '<img src=x onerror="alert(1)"> & text' };
  let requested;
  t.mock.method(globalThis, "fetch", async (url) => { requested = url; return response(hostile); });
  const view = createHarness(InteractiveLauncher);
  byId(view.render(), "issue-url").props.onChange({ target: { value: issueUrl } });
  byId(view.render(), "issue-url").props.onBlur();
  await settle();
  const html = renderToStaticMarkup(view.render());
  assert.equal(requested, `/api/github/issue?url=${encodeURIComponent(issueUrl)}`);
  assert.match(html, /ISSUE LOADED/);
  assert.match(html, /owner\/repository/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(render(IssuePreview, { issue: { ...preview, bodyPreview: "" } }), /This issue has no description/);
});

test("preview validates its origin, bounds, and exact requested URL", () => {
  assert.deepEqual(readIssuePreview(preview, issueUrl), preview);
  assert.ok(readIssuePreview({ ...preview, title: "a".repeat(1024) }, issueUrl));
  for (const change of [
    { issueUrl: "javascript:alert(1)" }, { owner: "other" }, { repository: "other" },
    { issueNumber: 13 }, { title: "" }, { title: "a".repeat(1025) }, { bodyPreview: "x".repeat(2001) },
  ]) assert.equal(readIssuePreview({ ...preview, ...change }, issueUrl), null);
});

test("preview normalizes a mixed-case GitHub origin and caches the resolved URL", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(url); return response(preview); });
  const view = createHarness(InteractiveLauncher);
  byId(view.render(), "issue-url").props.onChange({ target: { value: "HTTPS://GITHUB.COM/owner/repository/issues/12" } });
  byId(view.render(), "issue-url").props.onBlur();
  await settle();
  assert.match(renderToStaticMarkup(view.render()), /ISSUE LOADED/);
  assert.deepEqual(calls, [`/api/github/issue?url=${encodeURIComponent(issueUrl)}`]);
  button(view.render(), "Load issue preview").props.onClick();
  await settle();
  assert.equal(calls.length, 1);
});

test("switching to manual mode aborts a pending preview without showing its result", async (t) => {
  const pending = deferred();
  let signal;
  t.mock.method(globalThis, "fetch", async (_url, options) => { signal = options.signal; return pending.promise; });
  const view = createHarness(InteractiveLauncher);
  byId(view.render(), "issue-url").props.onChange({ target: { value: issueUrl } });
  byId(view.render(), "issue-url").props.onBlur();
  button(view.render(), "No GitHub issue?").props.onClick();
  assert.equal(signal.aborted, true);
  pending.resolve(response(preview));
  await settle();
  button(view.render(), "Use a GitHub issue instead").props.onClick();
  assert.doesNotMatch(renderToStaticMarkup(view.render()), /ISSUE LOADED|Loading issue/);
});

test("invalid issue preview never fetches; changing the URL aborts and hides an earlier response", async (t) => {
  const pending = deferred();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return pending.promise; });
  const view = createHarness(InteractiveLauncher);
  byId(view.render(), "issue-url").props.onChange({ target: { value: repositoryUrl } });
  byId(view.render(), "issue-url").props.onBlur();
  assert.match(textContent(view.render()), /Enter a GitHub issue URL/);
  assert.equal(calls.length, 0);
  byId(view.render(), "issue-url").props.onChange({ target: { value: issueUrl } });
  byId(view.render(), "issue-url").props.onBlur();
  assert.equal(calls.length, 1);
  byId(view.render(), "issue-url").props.onChange({ target: { value: issueUrl.replace("12", "13") } });
  assert.equal(calls[0].options.signal.aborted, true);
  pending.resolve(response(preview));
  await settle();
  assert.doesNotMatch(renderToStaticMarkup(view.render()), /ISSUE LOADED/);
});

test("issue submission sends only canonical input fields and locks synchronous repeated submissions", async (t) => {
  mockFormData(t);
  const pending = deferred();
  const calls = [];
  navigation.pushes.length = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return pending.promise; });
  const view = createHarness(InteractiveLauncher);
  const submit = form(view.render()).props.onSubmit;
  const event = { preventDefault() {}, currentTarget: {
    issueUrl, repositoryUrl: "https://github.com/attacker/other", issue: "Untrusted claimed issue body", title: "Claimed title",
    reproductionCommand: "npm run reproduce", requiredOutput: "Infinity",
  } };
  const first = submit(event);
  await submit(event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/missions");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    mode: "issue", issueUrl, reproductionCommand: "npm run reproduce", requiredOutput: "Infinity",
  });
  assert.equal(nodes(view.render(), (node) => node.type === "fieldset")[0].props.disabled, true);
  pending.resolve(response({ missionId: "web-created" }));
  await first;
  assert.deepEqual(navigation.pushes, ["/missions/web-created"]);
});

test("manual submission preserves validation and both advanced settings", async (t) => {
  mockFormData(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return response({ missionId: "web-manual" }); });
  const view = createHarness(InteractiveLauncher);
  button(view.render(), "No GitHub issue?").props.onClick();
  const submit = form(view.render()).props.onSubmit;
  const event = { preventDefault() {}, currentTarget: { repositoryUrl, issue: "Too short" } };
  await submit(event);
  assert.equal(calls.length, 0);
  assert.match(textContent(view.render()), /at least 20 characters/);
  event.currentTarget = { repositoryUrl, issue: details.description, reproductionCommand: "npm test", requiredOutput: "AssertionError", issueUrl };
  await form(view.render()).props.onSubmit(event);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    mode: "manual", repositoryUrl, issue: details.description, reproductionCommand: "npm test", requiredOutput: "AssertionError",
  });
});

test("MissionSummary uses issue title/body, safe issue/repository links, and existing facts", () => {
  const html = render(MissionSummary, { mission, details: { ...details, source: { ...details.source, githubIssue } } });
  assert.match(html, new RegExp(`<h1 id="mission-title">${preview.title}</h1>`));
  assert.match(html, new RegExp(preview.bodyPreview));
  assert.match(html, /href="https:\/\/github.com\/owner\/repository\/issues\/12" target="_blank" rel="noopener noreferrer"/);
  for (const label of ["Repository", "Execution status", "Base commit", "Changed files", "Investigation", "Export result JSON"]) assert.ok(html.includes(label));
  assert.match(html, /Create pull request/);
});

test("manual and old proof summaries preserve their display and explain missing patch digest", () => {
  const manualHtml = render(MissionSummary, { mission, details });
  assert.match(manualHtml, /Manual mission heading/);
  assert.match(manualHtml, /Manual description remains unchanged/);
  assert.doesNotMatch(manualHtml, /View original issue/);
  const oldProof = { ...mission, patch: { ...mission.patch, sha256: undefined } };
  const legacyHtml = render(MissionSummary, { mission: oldProof, details });
  assert.match(legacyHtml, /Export result JSON/);
  assert.match(legacyHtml, /no recorded patch digest/);
  assert.doesNotMatch(legacyHtml, /Create pull request|Create draft PR/);
});

test("verdict and execution state control normal, draft, and absent PR actions", () => {
  assert.match(render(MissionSummary, { mission, details }), /Create pull request/);
  const draft = render(MissionSummary, { mission: { ...mission, verdict: "REVIEW_REQUIRED" }, details });
  assert.match(draft, /Create draft PR/);
  assert.match(draft, /Human review is still required/);
  for (const result of [{ ...mission, verdict: "FAILED" }, { ...mission, status: "FAILED" }, { ...mission, patch: undefined }]) {
    assert.doesNotMatch(render(MissionSummary, { mission: result, details }), /Create pull request|Create draft PR/);
  }
});

test("live issue and manual missions retain the appropriate headings and source context", () => {
  const initialStatus = { missionId: details.id, status: "RUNNING", phase: "BASELINE", proofReady: false,
    repositoryUrl, issue: `${preview.title}\n\n${preview.bodyPreview}`, updatedAt: "2026-10-14T00:00:00.000Z", events: [], message: "Running" };
  const issueHtml = render(LiveMission, { initialStatus: { ...initialStatus, githubIssue } });
  assert.match(issueHtml, new RegExp(preview.title));
  assert.match(issueHtml, new RegExp(preview.bodyPreview));
  assert.match(issueHtml, /View original issue/);
  assert.match(issueHtml, /target="_blank" rel="noopener noreferrer"/);
  const manualHtml = render(LiveMission, { initialStatus });
  assert.match(manualHtml, /MISSION IN PROGRESS/);
  assert.match(manualHtml, /Reported issue/);
  assert.doesNotMatch(manualHtml, /View original issue/);
});

test("PR action synchronously prevents duplicate clicks, shows loading, then safe View PR link", async (t) => {
  const pending = deferred();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => { calls.push({ url, options }); return pending.promise; });
  const view = createHarness(PullRequestAction, { missionId: details.id, eligibility: { allowed: true, draft: false } });
  const click = button(view.render(), "Create pull request").props.onClick;
  click(); click();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { url: `/api/missions/${details.id}/pull-request`, options: { method: "POST" } });
  assert.equal(button(view.render(), "Creating PR...").props.disabled, true);
  pending.resolve(response({ number: 15, url: `${repositoryUrl}/pull/15`, draft: false }));
  await settle();
  const html = renderToStaticMarkup(view.render());
  assert.match(html, /View PR #15/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /<button/);
});

test("persisted PR renders its link immediately without creating a new PR", (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected publication"); });
  const view = createHarness(PullRequestAction, { missionId: details.id, eligibility: { allowed: true, draft: false },
    initialPullRequest: { number: 15, url: `${repositoryUrl}/pull/15`, draft: false } });
  assert.match(renderToStaticMarkup(view.render()), /View PR #15/);
  assert.equal(request.mock.callCount(), 0);
});

test("safe PR errors stay inline, allow retry, and never alter verdict evidence", async (t) => {
  const message = "Pull request creation is not configured on this PatchVerdict server.";
  t.mock.method(globalThis, "fetch", async () => response({ error: message }, false));
  const view = createHarness(PullRequestAction, { missionId: details.id, eligibility: { allowed: true, draft: false } });
  button(view.render(), "Create pull request").props.onClick();
  await settle();
  const tree = view.render();
  assert.match(renderToStaticMarkup(tree), /role="alert"/);
  assert.ok(textContent(tree).includes(message));
  assert.equal(button(tree, "Create pull request").props.disabled, false);
  assert.equal(mission.verdict, "VERIFIED");
});

test("malformed PR URLs and oversized error responses use controlled fallback messages", async (t) => {
  for (const value of [response({ number: 15, url: "javascript:alert(1)", draft: false }), response({ error: "secret".repeat(200) }, false)]) {
    t.mock.method(globalThis, "fetch", async () => value);
    const view = createHarness(PullRequestAction, { missionId: details.id, eligibility: { allowed: true, draft: false } });
    button(view.render(), "Create pull request").props.onClick();
    await settle();
    const html = renderToStaticMarkup(view.render());
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /javascript:|secret|View PR/);
    assert.ok(button(view.render(), "Create pull request"));
  }
});
