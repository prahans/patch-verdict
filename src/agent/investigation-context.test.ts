import { describe, expect, it } from "vitest";

import { createInvestigationBaselineContext } from "./investigation-context.js";

describe("createInvestigationBaselineContext", () => {
  it("preserves trusted reproduction facts", () => {
    const result = createInvestigationBaselineContext({
      command: "npm test",

      exitCode: 1,

      stdout: "Found multiple elements",

      stderr: "",

      requiredOutput: ["Found multiple elements"],
    });

    expect(result).toEqual({
      command: "npm test",

      exitCode: 1,

      reproduced: true,

      requiredOutput: ["Found multiple elements"],

      outputExcerpt: "Found multiple elements",
    });
  });

  it("bounds large test output", () => {
    const result = createInvestigationBaselineContext({
      command: "npm test",

      exitCode: 1,

      stdout: "x".repeat(20_000),

      stderr: "",
    });

    expect(result.outputExcerpt.length).toBeLessThanOrEqual(6000);
  });

  it("keeps the end of long failure output", () => {
    const result = createInvestigationBaselineContext({
      command: "npm test",

      exitCode: 1,

      stdout: `${"x".repeat(10_000)}FINAL_FAILURE`,

      stderr: "",
    });

    expect(result.outputExcerpt).toContain("FINAL_FAILURE");
  });
});
