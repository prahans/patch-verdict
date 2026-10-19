import { describe, expect, it } from "vitest";
import {
  parseMissionInput,
  parseBackendMissionInput,
  serializeBackendMissionInput,
} from "../../apps/web/lib/mission-input.js";
import { parseMissionEnvelope } from "./input-envelope.js";

const title = "addAttachment returns detached copy";
const body = "The builder should return a stored object and addParty must return an index.";
const githubIssue = {
  url: "https://github.com/vcon-dev/vcon-js/issues/7",
  number: 7,
  owner: "vcon-dev",
  repository: "vcon-js",
  title,
  body,
};
const reviewed = {
  path: "src/__tests__/reviewed-builder.test.ts",
  sourcePath: "src/vcon.ts",
  content: "test('return index', () => { expect(1).toBe(0); });",
  testIdentity: "return index",
  issueQuote: "addParty must return an index.",
  assertionQuote: "expect(1).toBe(0)",
  reason: "The returned index should be the position of the inserted party.",
};

describe("reviewed issue regression input boundaries", () => {
  it("round-trips an optional reviewed test from browser fields to strict backend", () => {
    const fromForm = parseMissionInput({
      mode: "issue",
      issueUrl: githubIssue.url,
      targetBranch: "main",
      reviewedRegressionJson: JSON.stringify(reviewed),
      reproductionCommand: "",
      requiredOutput: "",
    });
    expect(fromForm.mode).toBe("issue");
    if (fromForm.mode !== "issue") throw new Error("Expected issue form.");
    expect(fromForm.reviewedRegression).toEqual(reviewed);

    const input = parseBackendMissionInput({
      mode: "THIRD_PARTY_JS_TS",
      repositoryUrl: "https://github.com/vcon-dev/vcon-js",
      targetBranch: "main",
      defaultBranch: "main",
      baseCommit: "a".repeat(40),
      issue: title + "\n\n" + body,
      githubIssue,
      reviewedRegression: fromForm.reviewedRegression,
    });
    const result = parseMissionEnvelope(serializeBackendMissionInput(input));
    expect(result.reviewedRegression).toEqual(reviewed);
  });

  it("rejects unreviewed malformed test content or unexpected fields", () => {
    const form = {
      mode: "issue",
      issueUrl: githubIssue.url,
      targetBranch: "main",
      reviewedRegressionJson: "",
    };
    expect(parseMissionInput(form).mode).toBe("issue");
    for (const invalid of [
      { ...reviewed, path: "../outside.test.ts" },
      { ...reviewed, assertionQuote: "expect(false).toBe(true)" },
      { ...reviewed, secret: "not an allowed field" },
    ]) {
      expect(() =>
        parseMissionInput({
          ...form,
          reviewedRegressionJson: JSON.stringify(invalid),
        }),
      ).toThrow();
    }
  });
});
