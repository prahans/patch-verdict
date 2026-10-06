import { describe, expect, it } from "vitest";

import { validateDiscoveredReadPath } from "./investigation-paths.js";

describe("validateDiscoveredReadPath", () => {
  const files = [
    "package.json",
    "vitest.setup.ts",
    "src/utils/test-utils.tsx",
    "src/components/DarkMode.test.tsx",
  ];

  it("allows reads before a repository inventory exists", () => {
    expect(
      validateDiscoveredReadPath("src/known-from-baseline.ts", [], 0),
    ).toEqual({
      ok: true,
      path: "src/known-from-baseline.ts",
    });
  });

  it("accepts an exact discovered path", () => {
    expect(
      validateDiscoveredReadPath("./vitest.setup.ts", files, 4),
    ).toEqual({
      ok: true,
      path: "vitest.setup.ts",
    });
  });

  it("rejects an absent path within the discovered depth and suggests the exact basename", () => {
    const result = validateDiscoveredReadPath(
      "src/vitest.setup.ts",
      files,
      4,
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.suggestions).toContain("vitest.setup.ts");
    }
  });

  it("suggests a discovered extension variant instead of executing a guessed path", () => {
    const result = validateDiscoveredReadPath(
      "src/utils/test-utils.ts",
      files,
      4,
    );

    expect(result.ok).toBe(false);

    if (!result.ok) {
      expect(result.suggestions).toContain("src/utils/test-utils.tsx");
    }
  });

  it("allows a deeper path that a shallow listing could not have discovered", () => {
    expect(
      validateDiscoveredReadPath(
        "src/components/deep/Example.test.tsx",
        files,
        2,
      ),
    ).toEqual({
      ok: true,
      path: "src/components/deep/Example.test.tsx",
    });
  });
});
