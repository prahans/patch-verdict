import { describe, expect, it } from "vitest";
import {
  analyzeVerificationIntegrity,
  classifyVerificationPath,
} from "./integrity.js";

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

  it("returns REVIEW_REQUIRED when test support code changes", () => {
    const result = analyzeVerificationIntegrity({
      changedFiles: ["src/utils/test-utils.tsx"],
      diff: `
diff --git a/src/utils/test-utils.tsx b/src/utils/test-utils.tsx
--- a/src/utils/test-utils.tsx
+++ b/src/utils/test-utils.tsx
@@
+cleanup();
`.trim(),
    });

    expect(result.status).toBe("REVIEW_REQUIRED");
    expect(result.preserved).toBe(false);
    expect(result.reviewFlags.join(" ")).toContain("test support");
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

it("returns COMPROMISED when a candidate skips a test", () => {
  const result = analyzeVerificationIntegrity({
    changedFiles: ["src/components/DarkMode.test.tsx"],

    diff: `
diff --git a/src/components/DarkMode.test.tsx b/src/components/DarkMode.test.tsx
--- a/src/components/DarkMode.test.tsx
+++ b/src/components/DarkMode.test.tsx
@@
-test("dark mode", () => {
+test.skip("dark mode", () => {
`.trim(),
  });

  expect(result.status).toBe("COMPROMISED");

  expect(result.violations.join(" ")).toContain("skip");
});

it("returns COMPROMISED when a candidate focuses a test with only", () => {
  const result = analyzeVerificationIntegrity({
    changedFiles: ["src/components/DarkMode.test.tsx"],

    diff: `
diff --git a/src/components/DarkMode.test.tsx b/src/components/DarkMode.test.tsx
--- a/src/components/DarkMode.test.tsx
+++ b/src/components/DarkMode.test.tsx
@@
-describe("dark mode", () => {
+describe.only("dark mode", () => {
`.trim(),
  });

  expect(result.status).toBe("COMPROMISED");

  expect(result.violations.join(" ")).toContain("focused or skipped");
});

it("returns COMPROMISED when a protected test file is deleted", () => {
  const result = analyzeVerificationIntegrity({
    changedFiles: ["src/components/DarkMode.test.tsx"],

    diff: `
diff --git a/src/components/DarkMode.test.tsx b/src/components/DarkMode.test.tsx
deleted file mode 100644
--- a/src/components/DarkMode.test.tsx
+++ /dev/null
@@
-test("dark mode", () => {});
`.trim(),
  });

  expect(result.status).toBe("COMPROMISED");

  expect(result.violations.join(" ")).toContain("deleted");
});

it("returns COMPROMISED when a test is renamed so it is no longer discovered as a test", () => {
  const result = analyzeVerificationIntegrity({
    changedFiles: ["src/components/DarkMode.tsx.disabled"],

    diff: `
diff --git a/src/components/DarkMode.test.tsx b/src/components/DarkMode.tsx.disabled
similarity index 100%
rename from src/components/DarkMode.test.tsx
rename to src/components/DarkMode.tsx.disabled
`.trim(),
  });

  expect(result.status).toBe("COMPROMISED");

  expect(result.violations.join(" ")).toContain("renamed");
});

it("returns COMPROMISED when test discovery config excludes tests", () => {
  const result = analyzeVerificationIntegrity({
    changedFiles: ["vitest.config.ts"],

    diff: `
diff --git a/vitest.config.ts b/vitest.config.ts
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@
 export default defineConfig({
   test: {
+    exclude: ["src/components/DarkMode.test.tsx"],
   },
 });
`.trim(),
  });

  expect(result.status).toBe("COMPROMISED");

  expect(result.violations.join(" ")).toContain("test discovery");
});

it("returns COMPROMISED when a candidate removes an assertion", () => {
  const result = analyzeVerificationIntegrity({
    changedFiles: ["src/components/DarkMode.test.tsx"],

    diff: `
diff --git a/src/components/DarkMode.test.tsx b/src/components/DarkMode.test.tsx
--- a/src/components/DarkMode.test.tsx
+++ b/src/components/DarkMode.test.tsx
@@
 expect(screen.getByText(/light/)).toBeInTheDocument();
-expect(screen.queryByText(/dark/)).toBeNull();
`.trim(),
  });

  expect(result.status).toBe("COMPROMISED");

  expect(result.violations.join(" ")).toContain("removed assertion");
});

it("returns COMPROMISED when a specific assertion is weakened", () => {
  const result = analyzeVerificationIntegrity({
    changedFiles: ["src/components/DarkMode.test.tsx"],

    diff: `
diff --git a/src/components/DarkMode.test.tsx b/src/components/DarkMode.test.tsx
--- a/src/components/DarkMode.test.tsx
+++ b/src/components/DarkMode.test.tsx
@@
-expect(result).toBe("dark");
+expect(result).toBeDefined();
`.trim(),
  });

  expect(result.status).toBe("COMPROMISED");

  expect(result.violations.join(" ")).toContain("weakened assertion");
});

describe("classifyVerificationPath", () => {
  it("classifies direct test files", () => {
    expect(classifyVerificationPath("src/components/DarkMode.test.tsx")).toBe(
      "TEST_FILE",
    );
  });

  it("classifies test support", () => {
    expect(classifyVerificationPath("src/utils/test-utils.tsx")).toBe(
      "TEST_SUPPORT",
    );
  });

  it("classifies test infrastructure", () => {
    expect(classifyVerificationPath("vitest.setup.ts")).toBe(
      "TEST_INFRASTRUCTURE",
    );
  });

  it("classifies normal source files", () => {
    expect(classifyVerificationPath("src/components/DarkMode.tsx")).toBe(
      "OTHER",
    );
  });
});
