import { Readable } from "node:stream";
import { expect, it } from "vitest";
import { parseMissionEnvelope, readMissionEnvelope } from "./input-envelope.js";
const input = { version: 1, mode: "THIRD_PARTY_JS_TS", repositoryUrl: "https://github.com/owner/repo", issue: "Issue\n\nUnicode: 日本語 $() `command`",
  githubIssue: { url: "https://github.com/owner/repo/issues/1", number: 1, title: "Issue", owner: "owner", repository: "repo", body: "Unicode: 日本語 $() `command`" },
  targetBranch: "release/2.x-$test", defaultBranch: "main", baseCommit: "a".repeat(40) };
it("preserves Unicode and shell-sensitive untrusted text through stdin", async () => {
  expect(await readMissionEnvelope(Readable.from([Buffer.from(JSON.stringify(input))]))).toEqual(input);
});
it("rejects authority mismatch, missing branch, extra fields, and custom strict commands", () => {
  for (const changed of [{ repositoryUrl: "https://github.com/other/repo" }, { targetBranch: undefined }, { token: "secret" }, { reproductionCommand: "exit 1" }])
    expect(() => parseMissionEnvelope(JSON.stringify({ ...input, ...changed }))).toThrow();
});
it("rejects oversized or invalid UTF8 stdin", async () => {
  await expect(readMissionEnvelope(Readable.from([Buffer.alloc(70_000)]))).rejects.toThrow();
  await expect(readMissionEnvelope(Readable.from([Buffer.from([0xff])]))).rejects.toThrow();
});
it("keeps manual legacy fields", () => {
  expect(parseMissionEnvelope(JSON.stringify({ version: 1, mode: "LEGACY", repositoryUrl: input.repositoryUrl, issue: "manual", reproductionCommand: "pnpm test" })).mode).toBe("LEGACY");
});
