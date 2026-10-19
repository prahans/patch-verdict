import { describe, expect, it } from "vitest";
import { exactIssueQuoteOptions } from "./exact-issue-quotes.js";

describe("copy-ready canonical issue quotes", () => {
  it("offers verbatim title, problem and expected behavior without markdown headings", () => {
    const issue = [
      "addAttachment returns a detached copy and addParty returns no index",
      "",
      "## Problem",
      "",
      "- `addAttachment` pushes a detached copy into the vCon.",
      "- `addParty` returns `void` instead of the new index.",
      "",
      "## Expected",
      "",
      "The object returned from an add method is connected to the vCon.",
    ].join("\n");
    const choices = exactIssueQuoteOptions(issue);
    expect(choices).toContain("- `addAttachment` pushes a detached copy into the vCon.");
    expect(choices).toContain("- `addParty` returns `void` instead of the new index.");
    expect(choices).toContain("The object returned from an add method is connected to the vCon.");
    expect(choices).not.toContain("## Problem");
    expect(choices.every((quote) => issue.includes(quote))).toBe(true);
  });

  it("bounds extremely large untrusted issue lines and the total option count", () => {
    const issue = Array.from({ length: 80 }, (_, i) => `Issue behavior ${i}: ${"x".repeat(800)}`).join("\n");
    const choices = exactIssueQuoteOptions(issue);
    expect(choices).toHaveLength(20);
    expect(choices.every((quote) => quote.length <= 500 && issue.includes(quote))).toBe(true);
  });

  it("falls back to a literal snippet when the issue only has a markdown heading", () => {
    const issue = "## Broken attachment serialization";
    expect(exactIssueQuoteOptions(issue)).toEqual([issue]);
  });

  it("does not manufacture issue evidence from undersized input", () => {
    expect(exactIssueQuoteOptions("bug")).toEqual([]);
  });
});
