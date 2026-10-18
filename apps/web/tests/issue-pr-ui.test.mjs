import assert from "node:assert/strict";
import { proofV3Fixture } from "./helpers/proof-v3-fixture.mjs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./helpers/ui-loader.mjs";
import { createHarness, deferred, navigation, nodes, settle, textContent } from "./helpers/ui-harness.mjs";

const { MissionLauncher } = await import("../components/landing/mission-launcher.tsx");
const { MissionLauncher: InteractiveLauncher } = await import("../components/landing/mission-launcher.tsx?interactive");
const { IssuePreview, readIssuePreview } = await import("../components/landing/issue-preview.tsx");
const { BranchSelector, readBranchPage } = await import("../components/landing/branch-selector.tsx");
const { BranchSelector: InteractiveBranchSelector } = await import("../components/landing/branch-selector.tsx?interactive");
const { MissionOutcomeNotice, ThirdPartyEvidence, ThirdPartyProofChain } = await import("../components/mission/third-party-evidence.tsx");
const { MissionSummary } = await import("../components/mission/mission-summary.tsx");
const { LiveMission } = await import("../components/mission/live-mission.tsx");
const { PullRequestAction } = await import("../components/mission/pull-request-action.tsx?interactive");

const issueUrl = "https://github.com/owner/repository/issues/12";
const repositoryUrl = "https://github.com/owner/repository";
const preview = { owner: "owner", repository: "repository", issueNumber: 12, issueUrl, defaultBranch: "main", title: "Division by zero returns Infinity", bodyPreview: "Return zero when the denominator is zero." };
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

test("landing renders issue mode by default with framework-controlled verification and no manual inputs", () => {
  const html = render(MissionLauncher);
  assert.match(html, /GitHub issue URL/);
  assert.match(html, /https:\/\/github.com\/owner\/repo\/issues\/12/);
  assert.match(html, /Paste a public GitHub issue/);
  assert.doesNotMatch(html, /Advanced verification settings|name="reproductionCommand"|name="requiredOutput"/);
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
  assert.match(html, /ISSUE DETECTED/);
  assert.match(html, /owner\/repository/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(render(IssuePreview, { issue: { ...preview, bodyPreview: "" } }), /This issue has no body/);
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
  assert.match(renderToStaticMarkup(view.render()), /ISSUE DETECTED/);
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
  assert.doesNotMatch(renderToStaticMarkup(view.render()), /ISSUE DETECTED|Loading issue/);
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
  assert.doesNotMatch(renderToStaticMarkup(view.render()), /ISSUE DETECTED/);
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
    issueUrl, targetBranch: "release/2.x",
  } };
  const first = submit(event);
  await submit(event);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/missions");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    mode: "issue", issueUrl, targetBranch: "release/2.x", reproductionCommand: "", requiredOutput: "",
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
  event.currentTarget = { repositoryUrl, issue: details.description, reproductionCommand: "npm test", requiredOutput: "AssertionError" };
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
  for (const label of ["Repository", "Mission status", "Base commit", "Changed files", "Investigation", "Export evidence"]) assert.ok(html.includes(label));
  assert.match(html, /Create pull request/);
});

test("manual and old proof summaries preserve their display and explain missing patch digest", () => {
  const manualHtml = render(MissionSummary, { mission, details });
  assert.match(manualHtml, /Manual mission heading/);
  assert.match(manualHtml, /Manual description remains unchanged/);
  assert.doesNotMatch(manualHtml, /View original issue/);
  const oldProof = { ...mission, patch: { ...mission.patch, sha256: undefined } };
  const legacyHtml = render(MissionSummary, { mission: oldProof, details });
  assert.match(legacyHtml, /Export evidence/);
  assert.match(legacyHtml, /no verified patch digest/);
  assert.doesNotMatch(legacyHtml, /Create pull request|Create draft PR/);
});

test("verdict and execution state control normal, draft, and absent PR actions", () => {
  assert.match(render(MissionSummary, { mission, details }), /Create pull request/);
  const draft = render(MissionSummary, { mission: { ...mission, verdict: "REVIEW_REQUIRED" }, details });
  assert.match(draft, /Create draft PR/);
  assert.match(draft, /Human review is required/);
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


test("issue preview preselects the default target branch and clears it when issue changes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response({ ...preview, defaultBranch: "master" }));
  const view = createHarness(InteractiveLauncher);
  byId(view.render(), "issue-url").props.onChange({ target: { value: issueUrl } });
  byId(view.render(), "issue-url").props.onBlur();
  await settle();
  const html = renderToStaticMarkup(view.render());
  assert.match(html, /name="targetBranch"/);
  assert.match(html, /selected="" value="master"|value="master" selected=""/);
  assert.match(html, /master \(default\)/);
  byId(view.render(), "issue-url").props.onChange({ target: { value: issueUrl.replace("12", "13") } });
  assert.doesNotMatch(renderToStaticMarkup(view.render()), /name="targetBranch"/);
});

test("branch selector validates bounded pages and explicit branch lookup before selection", async (t) => {
  const selected = [];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return response({ repositoryUrl, branches: url.includes("exact=") ? ["release/2.x"] : ["main", "release/2.x"], nextPage: url.includes("exact=") ? null : 2 });
  });
  const view = createHarness(InteractiveBranchSelector, { issueUrl, defaultBranch: "main", value: "main", onChange: (value) => selected.push(value) });
  button(view.render(), "Browse branches").props.onClick();
  await settle();
  assert.ok(calls[0].includes("page=1"));
  assert.match(textContent(view.render()), /Next branch page/);
  byId(view.render(), "exact-target-branch").props.onChange({ target: { value: "release/2.x" } });
  button(view.render(), "Verify and select branch").props.onClick();
  await settle();
  assert.ok(calls[1].includes("exact=release%2F2.x"));
  assert.deepEqual(selected, ["release/2.x"]);
  const validPage = { repositoryUrl, branches: ["main"], nextPage: null };
  assert.deepEqual(readBranchPage(validPage, issueUrl), { branches: ["main"], nextPage: null });
  for (const bad of [{ ...validPage, repositoryUrl: "https://github.com/other/repo" }, { ...validPage, branches: Array(31).fill("main") }, { ...validPage, branches: ["bad\nbranch"] }, { ...validPage, nextPage: 101 }]) assert.equal(readBranchPage(bad, issueUrl), null);
  assert.match(render(BranchSelector, { issueUrl, defaultBranch: "main", value: "main", onChange() {} }), /main \(default\)/);
});


test("v3 UI separates generated target trust, production changes and unchanged background failures", () => {
  const fixture = proofV3Fixture({ generated: true, background: true });
  const proof = fixture.proof;
  const data = { ...proof, proofVersion: 3, patch: { ...proof.patch, diff: fixture.diff }, verificationIntegrity: proof.mission.verificationIntegrity, events: [] };
  const html = render(ThirdPartyEvidence, { mission: data }) + render(ThirdPartyProofChain, { mission: data });
  assert.match(html, /AI-generated regression/);
  assert.match(html, /Human review required/);
  assert.match(html, /Frozen SHA-256/);
  assert.match(html, /Unchanged/);
  assert.match(html, /1 existing failures/);
  assert.match(html, /UNCHANGED PREEXISTING FAILURES/);
  assert.match(html, /src\/divide.ts/);
  assert.match(html, /REVIEW_REQUIRED/);
  assert.doesNotMatch(html, /Full test suite passes/);
  const summary = render(MissionSummary, { mission: data, details: { ...details, source: proof.mission.source } });
  assert.match(summary, /release\/2.x/);
});

test("v3 terminal outcomes show branch-specific guidance and no publication action", () => {
  const fixture = proofV3Fixture();
  for (const outcome of ["TARGET_NOT_REPRODUCED", "UNSTABLE_REPRODUCTION", "UNSUPPORTED_REPOSITORY", "PREPARATION_FAILED", "UNSUPPORTED_REPAIR_SCOPE"]) {
    const data = { status: "COMPLETED", proofVersion: 3, outcome, verdict: null, events: [] };
    const sourceDetails = { ...details, source: fixture.proof.mission.source };
    const html = render(MissionOutcomeNotice, { mission: data, details: sourceDetails }) + render(MissionSummary, { mission: data, details: sourceDetails });
    assert.match(html, new RegExp(outcome.replaceAll("_", " ")));
    assert.match(html, /No repair verdict was issued/);
    assert.doesNotMatch(html, /Create (?:draft )?pull request/);
    if (outcome === "TARGET_NOT_REPRODUCED") assert.match(html, /Choose another target branch and start a new mission/);
  }
});

test("v3 UI shows skipped former passing background coverage as UNKNOWN with publication unavailable", () => {
  const fixture = proofV3Fixture();
  const proof = fixture.proof;
  proof.suiteComparison.postPatch.passed = proof.suiteComparison.postPatch.passed.filter(test => test.testIdentity !== "healthy behavior");
  proof.suiteComparison.state = "UNKNOWN";
  const data = { ...proof, verdict: "FAILED", proofVersion: 3, patch: { ...proof.patch, diff: fixture.diff }, verificationIntegrity: proof.mission.verificationIntegrity, events: [] };
  const html = render(ThirdPartyProofChain, { mission: data }) + render(MissionSummary, { mission: data, details: { ...details, source: proof.mission.source } });
  assert.match(html, /UNKNOWN/);
  assert.match(html, /FAILED/);
  assert.doesNotMatch(html, /Create (?:draft )?pull request/);
});
