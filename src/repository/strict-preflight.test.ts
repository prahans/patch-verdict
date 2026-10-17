import { describe, expect, it } from "vitest";
import { analyzeStrictProject } from "./detect-project.js";
import { RepositoryPreparationError } from "./errors.js";

const files = ["package.json", "package-lock.json", "src/divide.ts", "src/divide.test.ts"];
const pkg = { packageManager: "npm@10.0.0", scripts: { test: "vitest run" }, devDependencies: { vitest: "^3.0.0" } };
const profile = (overrides = {}, paths = files) => analyzeStrictProject(JSON.stringify({ ...pkg, ...overrides }), paths);

describe("strict JS/TS repository preflight", () => {
  it("records supported npm/Vitest single-package profile and immutable source", () => {
    const value = analyzeStrictProject(JSON.stringify(pkg), files, { targetBranch: "release/2.x", expectedCommit: "A".repeat(40) });
    expect(value).toMatchObject({ packageManager: "npm", testFramework: "vitest", languageFamily: "javascript-typescript", projectKind: "single-package", targetBranch: "release/2.x", baseCommit: "a".repeat(40) });
    expect(value.installCommand).toContain("--engine-strict");
  });
  it("accepts pnpm/Jest with supported source extensions", () => {
    expect(profile({ packageManager: "pnpm@9.0.0", scripts: { test: "jest" }, devDependencies: { jest: "^29.0.0" } }, ["package.json", "pnpm-lock.yaml", "index.cts"])).toMatchObject({ packageManager: "pnpm", testFramework: "jest" });
  });
  it.each([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts"])("supports production extension %s", (extension) => {
    expect(profile({}, ["package.json", "package-lock.json", `src/production${extension}`]).languageFamily).toBe("javascript-typescript");
  });
  it.each([
    [{ workspaces: [] }, files],
    [{}, [...files, "pnpm-workspace.yaml"]],
    [{}, [...files, "lerna.json"]],
    [{}, [...files, "nx.json"]],
    [{}, [...files, "packages/core/package.json", "turbo.json"]],
    [{ packageManager: "yarn@4.0.0" }, files],
    [{ packageManager: "bun@1.0.0" }, files],
    [{ packageManager: "pnpm@9.0.0" }, files],
    [{ packageManager: {} }, files],
    [{}, [...files, "pnpm-lock.yaml"]],
    [{}, files.filter((file) => file !== "package-lock.json")],
    [{}, [...files, "yarn.lock"]],
    [{}, [...files, "bun.lockb"]],
    [{ scripts: { test: "node scripts/tests.js" } }, files],
    [{ scripts: { test: "echo vitest" }, devDependencies: {} }, files],
    [{ scripts: { test: "vitest && jest" }, devDependencies: { vitest: "1", jest: "1" } }, files],
    [{ scripts: { test: "docker compose run vitest" } }, files],
    [{ devDependencies: { vitest: "1", "@playwright/test": "1" } }, files],
    [{}, ["package.json", "package-lock.json", "src/divide.test.ts", "vitest.config.ts", "types.d.ts"]],
  ])("rejects unsupported or ambiguous project metadata %#", (overrides, paths) => {
    expect(() => profile(overrides, paths as string[])).toThrow(RepositoryPreparationError);
    try { profile(overrides, paths as string[]); } catch (error) { expect(error).toMatchObject({ outcome: "UNSUPPORTED_REPOSITORY" }); }
  });
  it("does not reject turbo solely for being a dependency", () => {
    expect(profile({ devDependencies: { vitest: "1", turbo: "1" } }, [...files, "turbo.json"]).projectKind).toBe("single-package");
  });
  it.each(["[]", "null", "{", "x".repeat(256_001)])("rejects invalid or unbounded package metadata", (contents) => {
    expect(() => analyzeStrictProject(contents, files)).toThrow(RepositoryPreparationError);
  });
});
