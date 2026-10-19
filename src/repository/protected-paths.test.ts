import { describe, expect, it } from "vitest";
import {
  collectProtectedPaths,
  parseStaticVerificationConfig,
} from "./protected-paths.js";

describe("static verification configuration protection", () => {
  it("parses declarative Vitest config without running repository code", () => {
    const value = parseStaticVerificationConfig(
      "import { defineConfig } from 'vitest/config'; export default defineConfig({test:{globals:true, setupFiles:['./src/bootstrap.ts'], testTimeout:5000,},});",
    );
    expect(value).toMatchObject({
      imports: ["vitest/config"],
      config: { test: { globals: true, setupFiles: ["./src/bootstrap.ts"] } },
    });
  });
  it("protects nonstandard setup plus transitive imports and static config imports", async () => {
    const files: Record<string, string> = {
      "vitest.config.ts":
        "import {defineConfig} from 'vitest/config'; import './config-helper.js'; export default defineConfig({test:{setupFiles:['src/bootstrap.ts'],globalSetup:'src/global.ts'}});",
      "config-helper.ts": "import './config-leaf.ts';",
      "config-leaf.ts": "export const marker = true;",
      "src/bootstrap.ts":
        "import { beforeEach } from 'vitest'; import './helpers/reset.js'; beforeEach(()=>{});",
      "src/helpers/reset.ts": "export function reset() {}",
      "src/global.ts": "export default function setup() {}",
      "src/production.ts": "export const value = 1;",
    };
    expect(
      await collectProtectedPaths(
        Object.keys(files),
        "{}",
        async (file) => files[file]!,
      ),
    ).toEqual([
      "config-helper.ts",
      "config-leaf.ts",
      "src/bootstrap.ts",
      "src/global.ts",
      "src/helpers/reset.ts",
      "vitest.config.ts",
    ]);
  });
  it("protects package.json Jest setup/global teardown and custom environment", async () => {
    const files = ["setup.ts", "teardown.js", "custom-environment.js"];
    const pkg = {
      jest: {
        setupFilesAfterEnv: ["<rootDir>/setup.ts"],
        globalTeardown: "./teardown.js",
        testEnvironment: "./custom-environment.js",
      },
    };
    expect(
      await collectProtectedPaths(
        files,
        JSON.stringify(pkg),
        async () => "export {};",
      ),
    ).toEqual([...files].sort());
  });
  it("supports CommonJS declarative Jest config and built-in environment", async () => {
    expect(
      await collectProtectedPaths(
        ["jest.config.cjs"],
        "{}",
        async () => "module.exports = {testEnvironment:'node'};",
      ),
    ).toEqual(["jest.config.cjs"]);
  });

  it("supports the repository-installed ts-jest preset used by single-package TypeScript repos", async () => {
    const packageJson = JSON.stringify({
      devDependencies: {
        jest: "^29.7.0",
        "ts-jest": "^29.1.2",
      },
    });

    expect(
      await collectProtectedPaths(
        ["jest.config.js"],
        packageJson,
        async () =>
          "module.exports = {preset:'ts-jest',testEnvironment:'node',testMatch:['**/__tests__/**/*.test.ts'],transform:{'^.+\\\\.ts
  it.each([
    "export default defineConfig(() => ({test:{}}));",
    "export default {test:{setupFiles:process.env.SETUP}};",
    "export default {...other};",
    "export default {test:{['setup'+'Files']:['a.ts']}};",
    "export default makeConfig({});",
    "export default {test:{setupFiles:['one'],setupFiles:['two']}};",
    "const setup = 'a'; export default {setupFiles:[setup]};",
    "export default {test:{}}; changeConfig();",
  ])("rejects unclassifiable dynamic config %#", (source) => {
    expect(() => parseStaticVerificationConfig(source)).toThrow(
      /configuration/i,
    );
  });
  it.each([
    ["export default {test:{setupFiles:['../outside.ts']}};", ""],
    ["export default {test:{setupFiles:['missing.ts']}};", ""],
    ["export default {root:'src',test:{}};", ""],
    ["export default {test:{projects:[]}};", ""],
    [
      "export default {test:{setupFiles:['setup.ts']}};",
      "require(process.env.SETUP);",
    ],
    [
      "export default {test:{setupFiles:['setup.ts']}};",
      "import('./helper.ts' + name);",
    ],
  ])(
    "rejects unsafe setup or inherited project configuration %#",
    async (config, setup) => {
      await expect(
        collectProtectedPaths(
          ["vitest.config.ts", "setup.ts"],
          "{}",
          async (file) => (file === "vitest.config.ts" ? config : setup),
        ),
      ).rejects.toMatchObject({ outcome: "UNSUPPORTED_REPOSITORY" });
    },
  );
});
:'ts-jest'},moduleFileExtensions:['ts','js','json','node']};",
      ),
    ).toEqual(["jest.config.js"]);
  });

  it("rejects arbitrary inherited Jest presets even when declared as dependencies", async () => {
    await expect(
      collectProtectedPaths(
        ["jest.config.js"],
        JSON.stringify({ devDependencies: { jest: "29", "custom-preset": "1" } }),
        async () => "module.exports = {preset:'custom-preset'};",
      ),
    ).rejects.toMatchObject({ outcome: "UNSUPPORTED_REPOSITORY" });
  });
  it.each([
    "export default defineConfig(() => ({test:{}}));",
    "export default {test:{setupFiles:process.env.SETUP}};",
    "export default {...other};",
    "export default {test:{['setup'+'Files']:['a.ts']}};",
    "export default makeConfig({});",
    "export default {test:{setupFiles:['one'],setupFiles:['two']}};",
    "const setup = 'a'; export default {setupFiles:[setup]};",
    "export default {test:{}}; changeConfig();",
  ])("rejects unclassifiable dynamic config %#", (source) => {
    expect(() => parseStaticVerificationConfig(source)).toThrow(
      /configuration/i,
    );
  });
  it.each([
    ["export default {test:{setupFiles:['../outside.ts']}};", ""],
    ["export default {test:{setupFiles:['missing.ts']}};", ""],
    ["export default {root:'src',test:{}};", ""],
    ["export default {test:{projects:[]}};", ""],
    [
      "export default {test:{setupFiles:['setup.ts']}};",
      "require(process.env.SETUP);",
    ],
    [
      "export default {test:{setupFiles:['setup.ts']}};",
      "import('./helper.ts' + name);",
    ],
  ])(
    "rejects unsafe setup or inherited project configuration %#",
    async (config, setup) => {
      await expect(
        collectProtectedPaths(
          ["vitest.config.ts", "setup.ts"],
          "{}",
          async (file) => (file === "vitest.config.ts" ? config : setup),
        ),
      ).rejects.toMatchObject({ outcome: "UNSUPPORTED_REPOSITORY" });
    },
  );
});
