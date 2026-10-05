import type { Sandbox } from "e2b";
import { describe, expect, it } from "vitest";

import { runTestTool } from "./run-test.js";

describe("runTestTool selector validation", () => {
  const sandbox = {} as Sandbox;

  it.each([
    "",
    "   ",
    "test",
    "tests",
    "spec",
    "specs",
    "describe",
    "it",
    "all",
    "*",
    ".",
    ".*",
    ".+",
    "^.*$",
    "^.+$",
  ])("rejects overly broad selector %j", async (testName) => {
    const result = await runTestTool(sandbox, { testName });

    expect(result.ok).toBe(false);
  });

  it("explains why generic selectors are rejected", async () => {
    const result = await runTestTool(sandbox, {
      testName: "test",
    });

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.error).toContain("overly broad");
    }
  });
});
