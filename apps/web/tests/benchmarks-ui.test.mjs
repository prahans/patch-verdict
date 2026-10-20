import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./helpers/ui-loader.mjs";
import { createHarness, nodes, textContent } from "./helpers/ui-harness.mjs";

const { BenchmarkDashboard } = await import("../components/benchmarks/benchmark-dashboard.tsx");
const { BenchmarkSummary } = await import("../components/benchmarks/benchmark-summary.tsx");
const { VerdictDistribution } = await import("../components/benchmarks/verdict-distribution.tsx");
const { BenchmarkTable } = await import("../components/benchmarks/benchmark-table.tsx?interactive");
const { formatDuration, formatRate, selectBenchmarkRows } = await import("../lib/benchmarks/presentation.ts");

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
  benchmarks: rows, otherMissions: [row("unselected")], summary,
  notices: [], outputState: "available", discoveryTruncated: false, ...overrides,
});

test("dashboard states its controlled scope, uses truthful labels, and separates other recordings", () => {
  const html = render(BenchmarkDashboard, { data: dashboardData() });
  assert.match(html, /<h1[^>]*>Benchmark Dashboard<\/h1>/);
  assert.ok(html.includes("Measured outcomes from recorded PatchVerdict verification missions."));
  assert.ok(html.includes("Controlled benchmark results. Not a measure of general-purpose repair accuracy."));
  assert.match(html, /Other locally recorded missions/);
  assert.match(html, /Excluded from all controlled benchmark metrics/);
  const currentPageLink = nodes(BenchmarkDashboard({ data: dashboardData() }), (node) => node.props.href === "/benchmarks")[0];
  assert.equal(currentPageLink.props["aria-current"], "page");
  assert.match(html, /href="\/#verify"/);
  assert.match(html, /Measured test execution/);
  assert.match(html, /do not measure total AI mission runtime/);
  assert.match(html, /Overall mission duration/);
  assert.match(html, /1\/3 commands/);
  assert.match(html, /<th scope="col">Execution status<\/th>/);
  assert.match(html, /<th scope="col">Verdict<\/th>/);
  assert.match(html, /<caption[^>]*>Configured benchmark evidence/);
});

test("summary rate and distribution share the configured denominator, including unavailable rows", () => {
  const html = render(BenchmarkSummary, { summary });
  assert.match(html, /1 VERIFIED \/ 5 configured scenarios/);
  assert.match(html, />20(?:\.0)?%</);
  assert.match(html, /1 without a verdict/);
  assert.match(html, /1 unavailable/);
  assert.match(html, /unaffected by filters/);
  const chart = VerdictDistribution({ summary });
  const image = nodes(chart, (node) => node.props.role === "img")[0];
  assert.match(image.props["aria-label"], /5 configured scenarios: 1 VERIFIED, 1 REVIEW_REQUIRED, 1 FAILED, 2 No recorded verdict/);
  assert.deepEqual(nodes(image, (node) => node.props.style?.width).map((node) => node.props.style.width), ["20%", "20%", "20%", "40%"]);
  const distributionHtml = renderToStaticMarkup(chart);
  assert.match(distributionHtml, />40(?:\.0)?%</);
  assert.match(distributionHtml, /Missing evidence and missions without a verdict remain in that denominator/);
});

test("empty catalog and missing output show setup guidance and unavailable rate instead of invented success", () => {
  const html = render(BenchmarkDashboard, { data: dashboardData({
    benchmarks: [], otherMissions: [], summary: emptySummary, outputState: "missing",
    notices: ["No local output directory is available."],
  }) });
  assert.match(html, /No benchmark scenarios are configured/);
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
  assert.match(textContent(view.render()), /Showing 0 of 5 configured scenarios/);
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
  assert.match(renderToStaticMarkup(view.render()), /No recorded verdict/);
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

test("evidence links route to saved Mission Control and invalid identifiers render no link", () => {
  const view = createHarness(BenchmarkTable, { rows: [row("valid-id"), row("invalid-id", { missionId: "../secret", evidenceUrl: null })] });
  const html = renderToStaticMarkup(view.render());
  assert.match(html, /href="\/missions\/mission-valid-id"/);
  assert.match(html, /aria-label="View Evidence for valid-id"/);
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

test("other-mission controls use unique accessible labels and announce filtered results", () => {
  const view = createHarness(BenchmarkTable, { rows, cohort: "other" });
  const tree = view.render();
  for (const id of ["other-search", "other-verdict", "other-sort"]) {
    assert.ok(byId(tree, id));
    assert.ok(nodes(tree, (node) => node.type === "label" && node.props.htmlFor === id)[0]);
  }
  assert.match(textContent(nodes(tree, (node) => node.props.role === "status")[0]), /5 of 5 other recorded missions/);
  const region = nodes(tree, (node) => node.props.role === "region")[0];
  assert.equal(region.props.tabIndex, 0);
  assert.equal(region.props["aria-label"], "Other recorded mission results");
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
