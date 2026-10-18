// HTTP rendering smoke only: synthetic local fixtures, no AI, GitHub write, or mission launch.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { proofV3Fixture } from "../tests/helpers/proof-v3-fixture.mjs";

const base = new URL(process.argv[2] ?? "http://127.0.0.1:3000");
assert.equal(base.protocol, "http:");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname));
assert.ok(!base.username && !base.password && base.pathname === "/" && !base.search && !base.hash);
const repositoryRoot = await realpath(fileURLToPath(new URL("../../../", import.meta.url)));
await mkdir(path.join(repositoryRoot, "output"), { recursive: true });
const output = await realpath(path.join(repositoryRoot, "output"));
assert.equal(path.dirname(output), repositoryRoot);
const created = [];
async function fetchHtml(route) {
  const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, route);
  const html = await response.text();
  assert.doesNotMatch(html, /Mission artifacts could not be loaded/);
  return html;
}
try {
  const landing = await fetchHtml("/");
  assert.match(landing, /GitHub issue URL/);
  for (const scenario of ["existing-clean", "generated-background", "not-reproduced"]) {
    const id = `smoke-ui-${scenario}-${randomUUID()}`;
    const fixture = proofV3Fixture({ missionId: id, generated: scenario === "generated-background", background: scenario === "generated-background" });
    // Clearly identify synthetic data in the rendered page as well as its directory.
    fixture.proof.mission.source.githubIssue.title = "LOCAL UI SMOKE FIXTURE: " + scenario;
    fixture.proof.mission.issue = `${fixture.proof.mission.source.githubIssue.title}\n\n${fixture.proof.mission.source.githubIssue.body}`;
    if (scenario === "not-reproduced") Object.assign(fixture.proof, { outcome: "TARGET_NOT_REPRODUCED", verdict: null, patch: null, frozenReproduction: null, targetAfter: null, suiteComparison: null, repair: null, checks: null, artifacts: null });
    const directory = path.join(output, id);
    await mkdir(directory);
    created.push(directory);
    await mkdir(path.join(directory, "evidence"));
    for (const [filename, value] of [["proof.json", fixture.proof], ["events.json", fixture.events], ["patch.diff", fixture.diff], ["evidence/baseline-test.json", fixture.baseline], ["evidence/post-patch-test.json", fixture.postPatch], ["evidence/full-suite.json", fixture.fullSuite]]) {
      await writeFile(path.join(directory, filename), typeof value === "string" ? value : JSON.stringify(value), { flag: "wx", encoding: "utf8" });
    }
    const html = await fetchHtml(`/missions/${id}`);
    assert.match(html, /LOCAL UI SMOKE FIXTURE/);
    assert.match(html, /release\/2.x/);
    if (scenario === "existing-clean") assert.match(html, /VERIFIED/);
    if (scenario === "generated-background") {
      assert.match(html, /AI-generated regression/);
      assert.match(html, /Human review required/);
      assert.match(html, /UNCHANGED PREEXISTING FAILURES/);
      assert.match(html, /REVIEW_REQUIRED/);
    }
    if (scenario === "not-reproduced") {
      assert.match(html, /TARGET NOT REPRODUCED/);
      assert.match(html, /Choose another target branch/);
      assert.doesNotMatch(html, />Create (?:draft )?pull request</);
    }
    console.log(`PASS ${scenario}: HTTP rendering only`);
  }
} finally {
  for (const directory of created) {
    const resolved = await realpath(directory);
    assert.equal(path.dirname(resolved), output);
    assert.ok(path.basename(resolved).startsWith("smoke-ui-"));
    await rm(resolved, { recursive: true, force: true });
  }
}
