import { describe, expect, it } from "vitest";

import type { InvestigationBaselineContext } from "./investigation-context.js";
import {
  buildReconnaissanceContext,
  reconnaissanceForModel,
} from "./reconnaissance.js";

const baseline: InvestigationBaselineContext = {
  command: "npm test",
  exitCode: 1,
  reproduced: true,
  requiredOutput: ["Found multiple elements"],
  outputExcerpt: `
 FAIL  src/components/DarkMode.test.tsx > toggles dark mode
 TestingLibraryElementError: Found multiple elements
 ❯ src/components/DarkMode.test.tsx:49:16
`.trim(),
};

const files: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "fixture",
    packageManager: "npm@10.0.0",
    scripts: {
      test: "vitest run",
    },
    devDependencies: {
      vitest: "0.13.1",
      "@testing-library/react": "13.3.0",
    },
  }),

  "vite.config.ts": `
export default {
  test: {
    threads: false,
  },
};
`.trim(),

  "vitest.setup.ts": 'import "@testing-library/jest-dom";',

  "src/components/DarkMode.test.tsx":
    'test("toggles dark mode", () => {});',

  "src/components/DarkMode.tsx":
    "export function DarkMode() { return null; }",

  "src/utils/test-utils.tsx":
    "export const renderWithContext = () => {};",
};

describe("deterministic reconnaissance", () => {
  it("pre-inspects package, runner config, setup, and baseline failing files", async () => {
    const context = await buildReconnaissanceContext({
      baseline,
      access: {
        listFiles: async () => Object.keys(files),

        readFile: async (filePath) => {
          const content = files[filePath];

          if (content === undefined) {
            throw new Error("missing file");
          }

          return content;
        },
      },
    });

    expect(context.failingPaths).toEqual([
      "src/components/DarkMode.test.tsx",
    ]);

    expect(context.runnerConfigs).toEqual(["vite.config.ts"]);
    expect(context.testSetups).toEqual(["vitest.setup.ts"]);

    expect(context.preInspectedFiles).toEqual([
      "package.json",
      "src/components/DarkMode.test.tsx",
      "vite.config.ts",
      "vitest.setup.ts",
    ]);

    expect(context.packageSummary).toEqual({
      name: "fixture",
      packageManager: "npm@10.0.0",
      testScript: "vitest run",
      testFramework: "vitest",
      testFrameworkVersion: "0.13.1",
    });
  });

  it("does not pre-inspect unrelated implementation files merely because they exist", async () => {
    const context = await buildReconnaissanceContext({
      baseline,
      access: {
        listFiles: async () => Object.keys(files),
        readFile: async (filePath) => files[filePath]!,
      },
    });

    expect(context.preInspectedFiles).not.toContain(
      "src/components/DarkMode.tsx",
    );

    expect(context.preInspectedFiles).not.toContain(
      "src/utils/test-utils.tsx",
    );
  });

  it("records read failures without pretending the file was inspected", async () => {
    const context = await buildReconnaissanceContext({
      baseline,
      access: {
        listFiles: async () => Object.keys(files),
        readFile: async (filePath) => {
          if (filePath === "vite.config.ts") {
            throw new Error("read failed");
          }

          return files[filePath]!;
        },
      },
    });

    expect(context.readFailures).toEqual(["vite.config.ts"]);
    expect(context.preInspectedFiles).not.toContain("vite.config.ts");
  });

  it("provides a bounded model-facing inventory while retaining the full internal inventory", async () => {
    const largeInventory = Array.from(
      { length: 300 },
      (_, index) => `src/file-${String(index).padStart(3, "0")}.ts`,
    );

    const context = await buildReconnaissanceContext({
      baseline,
      access: {
        listFiles: async () => largeInventory,
        readFile: async () => "",
      },
    });

    const modelContext = reconnaissanceForModel(context);

    expect(context.inventory).toHaveLength(300);
    expect(modelContext.inventoryPreview).toHaveLength(250);
    expect(modelContext.inventoryTruncated).toBe(true);
  });
});
