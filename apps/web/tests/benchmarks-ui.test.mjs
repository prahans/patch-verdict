import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./helpers/ui-loader.mjs";
import { createHarness, navigation, nodes, textContent } from "./helpers/ui-harness.mjs";

const { BenchmarkDashboard } = await import("../components/benchmarks/benchmark-dashboard.tsx");
const { BenchmarkSummary } = await import("../components/benchmarks/benchmark-summary.tsx");
const { VerdictDistribution } = await import("../components/benchmarks/verdict-distribution.tsx");
const { BenchmarkTable } = await import("../components/benchmarks/benchmark-table.tsx?interactive");
const { BenchmarkRefresh } = await import("../components/benchmarks/benchmark-refresh.tsx?interactive");
const { formatDuration, formatRate, formatRecordedAt, selectBenchmarkRows } = await import("../lib/benchmarks/presentation.ts");

const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const byId = (tree, id) => nodes(tree, (node) => node.props.id === id)[0];
const displayedScenarios = (tree) => nodes(tree, (node) => node.props.className === "benchmark-scenario-name").map(textContent);
const change = (view, id, value) => byId(view.render(), id).props.onChange({ target: { value } });

function row(id, overrides = {}) {
  return {
    id, scenario: id, repository: "fixture/repository", missionId: `mission-${id}`,
    availability: "valid", unavailableReason: null, executionStatus: "COMPLETED", verdict: "VERIFIED",
    baselineReproduced: true, postPatchPassed: true, fullSuitePassed: true, integrity: "PRESERVED",
    changedFiles: 1, baseCommit: "a".repeat(40), iterations: 2, testDurationMs: 100,
    timedCommandCount: 1, commandDurations: { baseline: 100, postPatch: null, fullSuite: null },
    missionDurationMs: null, evidenceUrl: `/missions/mission-${id}`, evidenceWarnings: false,
    recordedAt: "2026-03-01T12:30:45.000Z", recordedAtSource: "event",
    ...overrides,
  };
}
const rows = Object.freeze([
  Object.freeze(row("Zulu", { testDurationMs: 300 })),
  Object.freeze(row("Bravo", { verdict: "REVIEW_REQUIRED", repository: "fixture/SECOND", testDurationMs: 0 })),
  Object.freeze(row("Alpha", { verdict: "FAILED", testDurationMs: 200, fullSuitePassed: false })),
  Object.freeze(row("Charlie", { executionStatus: "FAILED", verdict: null, testDurationMs: null, timedCommandCount: 0, integrity: null })),
  Object.freeze(row("Delta", { availability: "unavailable", executionStatus: null, verdict: null, testDurationMs: null, timedCommandCount: 0, unavailableReason: "Saved proof is unavailable." })),
]);
const summary = {
  configured: 5, valid: 4, verified: 1, reviewRequired: 1, failed: 1, noVerdict: 2,
  unavailable: 1, validWithoutVerdict: 1, verificationRate: 20,
  testDurationMs: 500, timedCommandCount: 3, timedMissionCount: 3,
};
const emptySummary = {
  configured: 0, valid: 0, verified: 0, reviewRequired: 0, failed: 0, noVerdict: 0,
  unavailable: 0, validWithoutVerdict: 0, verificationRate: null,
  testDurationMs: null, timedCommandCount: 0, timedMissionCount: 0,
};
const dashboardData = (overrides = {}) => ({
  benchmarks: rows, recordedMissions: [...rows, row("unselected")], summary,
  notices: [], outputState: "available", discoveryTruncated: false, ...overrides,
});

test("dashboard explains its controlled scope, selected results and separate recorded history", () => {
  const html = render(BenchmarkDashboard, { data: dashboardData() });
  assert.match(html, /<h1[^>]*>Benchmark Dashboard<\/h1>/);
  assert.ok(html.includes("Inspect recorded candidate repairs, checks, and verdicts from selected controlled scenarios."));
  assert.ok(html.includes("Selected runs. Available evidence."));
  assert.ok(html.includes("These selected historical runs do not measure general repair accuracy or predict rerun outcomes."));
  assert.match(html, /Controlled Benchmarks/);
  assert.match(html, /<section[^>]*aria-labelledby="recorded-missions-title"/);
  assert.match(html, /Recorded Mission History/);
  assert.ok(html.includes("Browse saved mission attempts, including recorded verdicts, failed executions, and unavailable evidence."));
  assert.ok(html.includes("Each scenario links to one specific historical run. New attempts do not replace these selections; unavailable evidence stays listed."));
  assert.ok(html.includes("This page checks for newly saved records while it is open."));
  assert.match(html, /Records refresh every 30 seconds while this page is visible/);
  assert.match(html, /Benchmark totals remain based on the 5 selected runs/);
  assert.ok(html.includes("History shows up to 100 saved attempts from a scan of up to 500 directory entries and may be incomplete. Active filters can hide results."));
  const currentPageLink = nodes(BenchmarkDashboard({ data: dashboardData() }), (node) => node.props.href === "/benchmarks")[0];
  assert.equal(currentPageLink.props["aria-current"], "page");
  assert.match(html, /href="\/#verify"/);
  assert.match(html, /Recorded Test Execution Time/);
  assert.match(html, /does not measure total mission duration/);
  assert.match(html, /Overall mission duration/);
  assert.match(html, /1\/3 command durations/);
  for (const label of ["Scenario / Repository", "Execution Status", "Repair Verdict", "Baseline Match", "Post-Repair Check", "Repository Tests", "Integrity Status", "Recorded Test Time", "Evidence"]) {
    assert.ok(html.includes(`<th scope="col">${label}</th>`));
  }
  assert.match(html, /<summary>Technical Details<\/summary>/);
  assert.match(html, /<caption[^>]*>Selected controlled scenarios and available evidence/);
  assert.doesNotMatch(html, /\bcohort\b|\bpinned\b|All Recorded Missions|Recorded details/i);
});

test("summary rate and distribution share the configured denominator, including unavailable rows", () => {
  const html = render(BenchmarkSummary, { summary });
  assert.match(html, /Benchmark Overview/);
  for (const label of ["Selected Controlled Scenarios", "Readable Proof Bundles", "VERIFIED", "REVIEW_REQUIRED", "FAILED", "No Verdict / Unavailable Evidence", "Verified Outcomes", "Recorded Test Execution Time"]) {
    assert.ok(html.includes(`<dt>${label}</dt>`));
  }
  for (const explanation of [
    "Recorded functional requirements passed, with no recognized verification-integrity review flags or violations detected.",
    "Functional requirements passed, but recorded verification-integrity concerns require human review.",
    "Completed verification did not meet the recorded acceptance conditions.",
  ]) {
    assert.ok(html.includes(explanation));
  }
  assert.match(html, /1 VERIFIED \/ 5 selected scenarios/);
  assert.match(html, />20(?:\.0)?%</);
  assert.match(html, /1 without a verdict/);
  assert.match(html, /1 unavailable/);
  assert.match(html, /unaffected by filters/);
  const chart = VerdictDistribution({ summary });
  const image = nodes(chart, (node) => node.props.role === "img")[0];
  assert.match(image.props["aria-label"], /5 selected scenarios: 1 VERIFIED, 1 REVIEW_REQUIRED, 1 FAILED, 2 No Verdict \/ Unavailable Evidence/);
  assert.deepEqual(nodes(image, (node) => node.props.style?.width).map((node) => node.props.style.width), ["20%", "20%", "20%", "40%"]);
  const distributionHtml = renderToStaticMarkup(chart);
  assert.match(distributionHtml, />40(?:\.0)?%</);
  assert.match(distributionHtml, /VERIFIED.*divided by all selected scenarios/);
  assert.match(distributionHtml, /Missing evidence and missions without a verdict remain in that denominator/);
  assert.ok(distributionHtml.includes("No saved verdict is available. The mission may have stopped early, or its evidence may be unreadable. Unavailable evidence is not a FAILED verdict."));
  assert.ok(distributionHtml.includes("VERIFIED applies to the recorded requirements and integrity checks. It does not guarantee correctness beyond that scope or human approval."));
});

test("empty catalog and missing output show setup guidance and unavailable rate instead of invented success", () => {
  const html = render(BenchmarkDashboard, { data: dashboardData({
    benchmarks: [], recordedMissions: [], summary: emptySummary, outputState: "missing",
    notices: ["No local output directory is available."],
  }) });
  assert.match(html, /No controlled scenarios selected/);
  assert.match(html, /apps\/web\/lib\/benchmarks\/catalog.ts/);
  assert.match(html, /docs\/BENCHMARK_DASHBOARD.md/);
  assert.match(html, /No local output directory is available/);
  assert.match(html, /distribution unavailable: no benchmark scenarios configured/);
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /100%|href="\/missions\//);
});

test("table callbacks filter by verdict and search scenario/repository without changing the recorded input", (t) => {
  const network = t.mock.method(globalThis, "fetch", () => { throw new Error("Dashboard must not execute a mission"); });
  const original = JSON.stringify(rows);
  const view = createHarness(BenchmarkTable, { rows, cohort: "benchmarks" });
  assert.deepEqual(displayedScenarios(view.render()), ["Alpha", "Bravo", "Charlie", "Delta", "Zulu"]);
  change(view, "benchmarks-verdict", "REVIEW_REQUIRED");
  assert.deepEqual(displayedScenarios(view.render()), ["Bravo"]);
  change(view, "benchmarks-search", "  SECOND ");
  assert.deepEqual(displayedScenarios(view.render()), ["Bravo"]);
  change(view, "benchmarks-search", "not-a-repository");
  assert.match(textContent(view.render()), /No matching results/);
  assert.match(textContent(view.render()), /Showing 0 of 5 selected scenarios/);
  const clear = nodes(view.render(), (node) => node.type === "button" && textContent(node) === "Clear filters")[0];
  clear.props.onClick();
  assert.equal(displayedScenarios(view.render()).length, 5);
  change(view, "benchmarks-search", "zUL");
  assert.deepEqual(displayedScenarios(view.render()), ["Zulu"]);
  assert.equal(JSON.stringify(rows), original);
  assert.equal(network.mock.callCount(), 0);
});

test("no-verdict filter includes failed executions and unavailable proofs without treating either as FAILED verdict", () => {
  const view = createHarness(BenchmarkTable, { rows });
  change(view, "benchmarks-verdict", "none");
  assert.deepEqual(displayedScenarios(view.render()), ["Charlie", "Delta"]);
  assert.match(renderToStaticMarkup(view.render()), /No Verdict Recorded/);
  change(view, "benchmarks-verdict", "FAILED");
  assert.deepEqual(displayedScenarios(view.render()), ["Alpha"]);
  change(view, "benchmarks-verdict", "VERIFIED");
  assert.deepEqual(displayedScenarios(view.render()), ["Zulu"]);
});

test("scenario, measured-duration and verdict sorting preserve inputs and always place missing times last", () => {
  const view = createHarness(BenchmarkTable, { rows });
  for (const [sort, expected] of [
    ["scenario-desc", ["Zulu", "Delta", "Charlie", "Bravo", "Alpha"]],
    ["duration-asc", ["Bravo", "Alpha", "Zulu", "Charlie", "Delta"]],
    ["duration-desc", ["Zulu", "Alpha", "Bravo", "Charlie", "Delta"]],
    ["verdict-asc", ["Zulu", "Bravo", "Alpha", "Charlie", "Delta"]],
    ["scenario-asc", ["Alpha", "Bravo", "Charlie", "Delta", "Zulu"]],
  ]) {
    change(view, "benchmarks-sort", sort);
    assert.deepEqual(displayedScenarios(view.render()), expected);
  }
  assert.deepEqual(rows.map((value) => value.scenario), ["Zulu", "Bravo", "Alpha", "Charlie", "Delta"]);
  const selected = selectBenchmarkRows(rows, { search: "second", verdict: "REVIEW_REQUIRED", sort: "duration-desc" });
  assert.deepEqual(selected.map((value) => value.scenario), ["Bravo"]);
});

test("only valid proof rows link to saved Mission Control, even if an unavailable row has a URL", () => {
  const view = createHarness(BenchmarkTable, { rows: [
    row("valid-id"),
    row("invalid-id", { missionId: "../secret", evidenceUrl: null }),
    row("unsupported", { availability: "unavailable", unavailableReason: "Saved proof uses an unsupported proof version.", verdict: null }),
    row("missing", { availability: "unavailable", unavailableReason: "Saved proof is missing.", verdict: null }),
  ] });
  const html = renderToStaticMarkup(view.render());
  assert.match(html, /href="\/missions\/mission-valid-id"/);
  assert.match(html, /aria-label="View Evidence for valid-id"/);
  assert.match(html, /unsupported proof version/);
  assert.match(html, /Saved proof is missing/);
  assert.equal((html.match(/href="\/missions\//g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="[^\"]*\.\.\//);
});

test("repository, scenario and unavailable messages render as escaped untrusted text", () => {
  const view = createHarness(BenchmarkTable, { rows: [row("hostile", {
    scenario: '<script>alert("scenario")</script>', repository: '<img src=x onerror="alert(1)">',
    unavailableReason: '<svg onload="alert(1)">',
  })] });
  const html = renderToStaticMarkup(view.render());
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;svg/);
  assert.doesNotMatch(html, /<script>|<img|<svg onload/);
});

test("recorded-mission controls use unique accessible labels and announce filtered results", () => {
  const view = createHarness(BenchmarkTable, { rows, cohort: "recorded" });
  const tree = view.render();
  for (const id of ["recorded-search", "recorded-verdict", "recorded-sort"]) {
    assert.ok(byId(tree, id));
    assert.ok(nodes(tree, (node) => node.type === "label" && node.props.htmlFor === id)[0]);
  }
  assert.match(textContent(nodes(tree, (node) => node.props.role === "status")[0]), /5 of 5 recorded missions/);
  const region = nodes(tree, (node) => node.props.role === "region")[0];
  assert.equal(region.props.tabIndex, 0);
  assert.equal(region.props["aria-label"], "Recorded mission history");
});

test("duration and rate formatting retain missing data and genuine zero without mis-scaling percentages", () => {
  assert.equal(formatDuration(null), "Unavailable");
  assert.equal(formatDuration(0), "0 ms");
  assert.equal(formatDuration(840), "840 ms");
  assert.equal(formatDuration(1500), "1.5 s");
  assert.equal(formatRate(null), "Unavailable");
  assert.match(formatRate(0), /^0(?:\.0)?%$/);
  assert.match(formatRate(50), /^50(?:\.0)?%$/);
  assert.match(formatRate(100), /^100(?:\.0)?%$/);
});

test("recorded history defaults newest-first, labels timestamp provenance and keeps missing dates last", () => {
  const attempts = [
    row("earlier", { missionId: "attempt-01", recordedAt: "2026-03-01T08:00:00.000Z" }),
    row("later", { missionId: "attempt-02", recordedAt: "2026-03-02T08:00:00.000Z", recordedAtSource: "artifact" }),
    row("unknown", { recordedAt: null, recordedAtSource: null }),
  ];
  const view = createHarness(BenchmarkTable, { rows: attempts, cohort: "recorded" });
  assert.deepEqual(displayedScenarios(view.render()), ["later", "earlier", "unknown"]);
  assert.equal(byId(view.render(), "recorded-sort").props.value, "recorded-desc");
  const html = renderToStaticMarkup(view.render());
  assert.match(html, /class="benchmark-mission-id">attempt-02</);
  assert.match(html, /Artifact saved: <time dateTime="2026-03-02T08:00:00.000Z">2026-03-02 08:00:00 UTC<\/time>/);
  assert.match(html, /Recorded: <time dateTime="2026-03-01T08:00:00.000Z">2026-03-01 08:00:00 UTC<\/time>/);
  assert.match(html, /Recorded: Unavailable/);
  change(view, "recorded-sort", "recorded-asc");
  assert.deepEqual(displayedScenarios(view.render()), ["earlier", "later", "unknown"]);
  change(view, "recorded-search", "attempt-02");
  assert.deepEqual(displayedScenarios(view.render()), ["later"]);
  assert.equal(formatRecordedAt("invalid"), "Unavailable");
  assert.equal(formatRecordedAt(null), "Unavailable");
});

test("refreshed data appears in history while search, verdict and sorting remain selected", () => {
  const original = [
    row("older", { repository: "fixture/target", recordedAt: "2026-03-01T00:00:00.000Z" }),
    row("review", { repository: "fixture/target", verdict: "REVIEW_REQUIRED" }),
  ];
  const view = createHarness(BenchmarkTable, { rows: original, cohort: "recorded" });
  change(view, "recorded-search", "fixture/target");
  change(view, "recorded-verdict", "VERIFIED");
  change(view, "recorded-sort", "recorded-asc");
  const fresh = row("newer", { repository: "fixture/target", recordedAt: "2026-03-03T00:00:00.000Z" });
  const refreshed = view.render({ rows: [...original, fresh, row("unrelated")], cohort: "recorded" });
  assert.deepEqual(displayedScenarios(refreshed), ["older", "newer"]);
  assert.equal(byId(refreshed, "recorded-search").props.value, "fixture/target");
  assert.equal(byId(refreshed, "recorded-verdict").props.value, "VERIFIED");
  assert.equal(byId(refreshed, "recorded-sort").props.value, "recorded-asc");
  assert.match(textContent(refreshed), /Showing 2 of 4 recorded missions/);
  assert.equal(original.length, 2);
});

function refreshEnvironment(t, visibilityState = "visible") {
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const listeners = new Set();
  const timers = new Map();
  let nextTimer = 0;
  const document = {
    visibilityState,
    addEventListener(name, callback) {
      assert.equal(name, "visibilitychange");
      listeners.add(callback);
    },
    removeEventListener(name, callback) {
      assert.equal(name, "visibilitychange");
      listeners.delete(callback);
    },
  };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  t.mock.method(globalThis, "setInterval", (callback, delay) => {
    assert.equal(delay, 30_000);
    timers.set(++nextTimer, callback);
    return nextTimer;
  });
  t.mock.method(globalThis, "clearInterval", (id) => timers.delete(id));
  t.mock.method(globalThis, "fetch", () => { throw new Error("Refresh must not call a mission endpoint"); });
  navigation.pathname = "/benchmarks";
  navigation.refreshes = 0;
  t.after(() => {
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else delete globalThis.document;
    navigation.pathname = "/benchmarks";
    navigation.refreshes = 0;
  });
  return {
    timers, listeners,
    setVisibility(value) {
      document.visibilityState = value;
      for (const listener of listeners) listener();
    },
    tick() {
      for (const callback of timers.values()) callback();
    },
  };
}

test("automatic refresh runs only on visible benchmarks, preserves one timer and cleans up on route/unmount", (t) => {
  const browser = refreshEnvironment(t);
  const view = createHarness(BenchmarkRefresh, {}, { effects: true });
  assert.equal(view.render(), null);
  assert.equal(browser.timers.size, 1);
  assert.equal(browser.listeners.size, 1);
  assert.equal(navigation.refreshes, 0);
  browser.tick();
  assert.equal(navigation.refreshes, 1);
  view.render();
  assert.equal(browser.timers.size, 1);
  browser.setVisibility("visible");
  assert.equal(browser.timers.size, 1);
  const queuedBeforeHide = [...browser.timers.values()][0];
  browser.setVisibility("hidden");
  assert.equal(browser.timers.size, 0);
  queuedBeforeHide();
  assert.equal(navigation.refreshes, 1);
  browser.setVisibility("visible");
  assert.equal(browser.timers.size, 1);
  browser.tick();
  assert.equal(navigation.refreshes, 2);
  const queuedBeforeNavigation = [...browser.timers.values()][0];
  navigation.pathname = "/missions/fixture";
  view.render();
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.listeners.size, 0);
  queuedBeforeNavigation();
  assert.equal(navigation.refreshes, 2);
  browser.setVisibility("visible");
  assert.equal(browser.timers.size, 0);
  navigation.pathname = "/benchmarks";
  view.render();
  assert.equal(browser.timers.size, 1);
  view.unmount();
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.listeners.size, 0);
  // Strict Mode's setup/cleanup/setup sequence must not leave old timers behind.
  view.render();
  assert.equal(browser.timers.size, 1);
  assert.equal(browser.listeners.size, 1);
  view.unmount();
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.listeners.size, 0);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});

test("automatic refresh does not start in an inactive tab or on another route", (t) => {
  const browser = refreshEnvironment(t, "hidden");
  const view = createHarness(BenchmarkRefresh, {}, { effects: true });
  view.render();
  assert.equal(browser.timers.size, 0);
  browser.tick();
  assert.equal(navigation.refreshes, 0);
  browser.setVisibility("visible");
  assert.equal(browser.timers.size, 1);
  view.unmount();
  navigation.pathname = "/";
  view.render();
  assert.equal(browser.timers.size, 0);
  assert.equal(browser.listeners.size, 0);
  view.unmount();
});
