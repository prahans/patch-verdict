import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "./helpers/ui-loader.mjs";

const { PublicShowcase } = await import("../components/landing/public-showcase.tsx");
const { Hero } = await import("../components/landing/hero.tsx");
const { LandingHeader } = await import("../components/landing/landing-header.tsx");
const { LandingFooter } = await import("../components/landing/landing-footer.tsx");
const { MissionHeader } = await import("../components/mission/mission-header.tsx");
const { MissionSummary } = await import("../components/mission/mission-summary.tsx");

const render = (Component, props = {}) =>
  renderToStaticMarkup(createElement(Component, props));

test("public showcase displays saved-evidence links rather than a mission submission form", () => {
  const html = render(PublicShowcase);
  assert.match(html, /id="showcase"/);
  assert.match(html, /Explore Benchmark Results/);
  assert.match(html, /href="\/benchmarks"/);
  assert.match(html, /Flight Recorder|Verification evidence/);
  assert.doesNotMatch(html, /<form|<input|<textarea|Run verification|Start verification/);
});

test("public landing and mission navigation target benchmark and evidence pages", () => {
  for (const html of [
    render(Hero, { proofExampleId: null }),
    render(LandingHeader),
    render(LandingFooter),
    render(MissionHeader, { verdict: "VERIFIED" }),
  ]) {
    assert.match(html, /href="\/benchmarks"/);
    assert.doesNotMatch(html, /href="#verify"|href="\/#verify"|Start verification|New mission/);
  }
  const hero = render(Hero, { proofExampleId: "web-saved" });
  assert.match(hero, /href="\/missions\/web-saved"/);
});

test("saved mission presentation hides PR creation while retaining export and recorded facts", () => {
  const baseCommit = "a".repeat(40);
  const mission = {
    status: "COMPLETED", verdict: "VERIFIED", events: [],
    investigation: { iterations: 2 },
    patch: {
      applied: true, baseCommit, changedFiles: ["src/change.ts"],
      diff: "diff --git a/src/change.ts b/src/change.ts\n",
      sha256: "b".repeat(64),
    },
  };
  const details = {
    id: "web-saved", title: "Saved investigation", description: "Recorded outcome",
    reproduction: { label: "Reproduction", command: "npm test" },
    fullSuite: { label: "Repository test", command: "npm test" },
    source: { repositoryUrl: "https://github.com/fixture/example", baseCommit },
  };
  const interactive = render(MissionSummary, { mission, details });
  assert.match(interactive, /Create pull request/);
  const showcase = render(MissionSummary, { mission, details, hidePublicationAction: true });
  assert.match(showcase, /Export result JSON/);
  assert.match(showcase, /Saved investigation|Base commit/);
  assert.doesNotMatch(showcase, /Create pull request|Create draft PR/);
});
