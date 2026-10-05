import { describe, expect, it } from "vitest";

import { analyzeVerificationIntegrity } from "./integrity.js";

describe("analyzeVerificationIntegrity", () => {
  it("returns PRESERVED for normal source changes", () => {
    const result = analyzeVerificationIntegrity({
      changedFiles: ["src/components/DarkMode.tsx"],
      diff: `
diff --git a/src/components/DarkMode.tsx b/src/components/DarkMode.tsx
--- a/src/components/DarkMode.tsx
+++ b/src/components/DarkMode.tsx
@@
-return oldValue;
+return newValue;
`.trim(),
    });

    expect(result.status).toBe("PRESERVED");
    expect(result.preserved).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.reviewFlags).toEqual([]);
  });

  it("returns REVIEW_REQUIRED when a protected test file changes", () => {
    const result = analyzeVerificationIntegrity({
      changedFiles: ["src/components/DarkMode.test.tsx"],
      diff: `
diff --git a/src/components/DarkMode.test.tsx b/src/components/DarkMode.test.tsx
--- a/src/components/DarkMode.test.tsx
+++ b/src/components/DarkMode.test.tsx
@@
+afterEach(cleanup);
`.trim(),
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.preserved).toBe(false);
    expect(result.protectedChangedFiles).toEqual([
      "src/components/DarkMode.test.tsx",
    ]);
    expect(result.reviewFlags.length).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });

  it("returns REVIEW_REQUIRED when test infrastructure changes", () => {
    const result = analyzeVerificationIntegrity({
      changedFiles: ["vitest.setup.ts"],
      diff: `
diff --git a/vitest.setup.ts b/vitest.setup.ts
--- a/vitest.setup.ts
+++ b/vitest.setup.ts
@@
+afterEach(cleanup);
`.trim(),
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.preserved).toBe(false);
    expect(result.reviewFlags.length).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });

  it("returns COMPROMISED when the package test script changes", () => {
    const result = analyzeVerificationIntegrity({
      changedFiles: ["package.json"],
      diff: `
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@
-    "test": "vitest run"
+    "test": "echo success"
`.trim(),
    });

    expect(result.status).toBe("COMPROMISED");
    expect(result.preserved).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
  });
});
