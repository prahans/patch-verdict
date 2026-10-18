import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Sandbox } from "e2b";
import { createRegressionWriter, createStrictRepairPolicy, createStrictRepositoryTools, isProductionRepairPath } from "./strict-policy.js";

let root: string;
let sandbox: Sandbox;

beforeEach(async () => {
  root = await mkdtemp(path.join(process.cwd(), ".strict-policy-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/calc.ts"), "export const calc = () => 1;\n");
  await writeFile(path.join(root, "src/other.ts"), "export const other = () => 1;\n");
  await writeFile(path.join(root, "src/calc.test.ts"), "test('returns two', () => expect(calc()).toBe(2));\n");
  sandbox = { commands: { run: async (command: string) => {
    // Execute exactly the trusted encoded filesystem program, never a shell.
    const script = /Buffer\.from\("([A-Za-z0-9+/=]+)","base64"\)/.exec(command)?.[1];
    const payload = /'([A-Za-z0-9+/=]+)'$/.exec(command)?.[1];
    if (!script || !payload) throw new Error("Unexpected sandbox command");
    const stdout = execFileSync(process.execPath, ["-e", Buffer.from(script, "base64").toString("utf8"), payload], { cwd: root, encoding: "utf8" });
    return { exitCode: 0, stdout, stderr: "" };
  } } } as unknown as Sandbox;
});

afterEach(async () => {
  expect(path.dirname(root)).toBe(process.cwd());
  expect(path.basename(root)).toMatch(/^\.strict-policy-/);
  await rm(root, { recursive: true, force: true });
});

describe("strict repository tools", () => {
  it("treats shell-sensitive source/search text as data and blocks all non-read tool names", async () => {
    const tools = createStrictRepositoryTools(root);
    const text = "literal $(bad); 'quoted' `command`";
    await writeFile(path.join(root, "src/quoted.ts"), text);
    expect(await tools(sandbox, "search_code", { query: text })).toMatchObject({ ok: true, data: { matches: [{ line: expect.stringContaining(text) }] } });
    expect(await tools(sandbox, "apply_patch", { path: "src/calc.ts" })).toMatchObject({ ok: false });
    for (const file of ["../outside", "/tmp/x", "C:/x", "src\\calc.ts", ".git/config", ".env", "src/../calc.ts"]) {
      expect(await tools(sandbox, "read_file", { path: file })).toMatchObject({ ok: false });
    }
  });

  it("refuses symlink directories, hardlinks, binary files, and oversized reads", async () => {
    const tools = createStrictRepositoryTools(root);
    await symlink(path.join(root, "src"), path.join(root, "linked"), process.platform === "win32" ? "junction" : "dir");
    expect(await tools(sandbox, "read_file", { path: "linked/calc.ts" })).toMatchObject({ ok: false });
    await link(path.join(root, "src/calc.ts"), path.join(root, "src/hard.ts"));
    expect(await tools(sandbox, "read_file", { path: "src/hard.ts" })).toMatchObject({ ok: false });
    await writeFile(path.join(root, "src/binary.ts"), Buffer.from([0, 255]));
    expect(await tools(sandbox, "read_file", { path: "src/binary.ts" })).toMatchObject({ ok: false });
    await writeFile(path.join(root, "src/huge.ts"), "a".repeat(131073));
    expect(await tools(sandbox, "read_file", { path: "src/huge.ts" })).toMatchObject({ ok: false });
  });
});

describe("stateful regression writer", () => {
  it("creates only one new file, permits one same-file correction, and permanently freezes", async () => {
    const writer = createRegressionWriter(root);
    expect(await writer.write(sandbox, { path: "src/generated.test.ts", content: "test('a', () => expect(1).toBe(2));" })).toMatchObject({ ok: true });
    expect(await writer.write(sandbox, { path: "src/second.test.ts", content: "test('b', () => {});" })).toMatchObject({ ok: false });
    expect(await writer.write(sandbox, { path: "src/generated.test.ts", content: "test('a', () => expect(calc()).toBe(2));" })).toMatchObject({ ok: true });
    expect(writer.attempts).toBe(2);
    expect(await writer.write(sandbox, { path: "src/generated.test.ts", content: "test('a', () => {});" })).toMatchObject({ ok: false });
    writer.freeze();
    expect(await writer.write(sandbox, { path: "src/generated.test.ts", content: "changed" })).toMatchObject({ ok: false, error: expect.stringMatching(/frozen/) });
    expect(await readFile(path.join(root, "src/generated.test.ts"), "utf8")).toContain("calc()");
  });

  it("never overwrites an existing test or writes production/config files", async () => {
    const before = await readFile(path.join(root, "src/calc.test.ts"));
    expect(await createRegressionWriter(root).write(sandbox, { path: "src/calc.test.ts", content: "test('bad', () => {});" })).toMatchObject({ ok: false });
    expect(await readFile(path.join(root, "src/calc.test.ts"))).toEqual(before);
    for (const file of ["src/calc.ts", "package.json", "vitest.config.ts", "../test.spec.ts", ".git/a.test.ts", "src/a.test.mts"]) {
      expect(await createRegressionWriter(root).write(sandbox, { path: file, content: "test('bad', () => {});" })).toMatchObject({ ok: false });
    }
  });

  it("blocks changed generated bytes, invalid UTF-8, skipped tests, and oversized contents", async () => {
    const writer = createRegressionWriter(root);
    const file = "src/generated.test.ts";
    expect(await writer.write(sandbox, { path: file, content: "test('a', () => expect(1).toBe(2));" })).toMatchObject({ ok: true });
    await writeFile(path.join(root, file), "external mutation");
    expect(await writer.write(sandbox, { path: file, content: "test('a', () => expect(1).toBe(3));" })).toMatchObject({ ok: false });
    for (const content of ["\ud800", "a".repeat(32769), "test.only('a', () => {});", "test.skip('a', () => {});", "a\0b"]) {
      expect(await createRegressionWriter(root).write(sandbox, { path: "src/reject.test.ts", content })).toMatchObject({ ok: false });
    }
  });
});

describe("strict candidate repair policy", () => {
  it("retains one-file scope across corrections and blocks protected/ungrounded writes", async () => {
    const policy = createStrictRepairPolicy({ projectRoot: root, allowedProductionFiles: ["src/calc.ts", "src/other.ts", "src/calc.test.ts"], frozenTestPath: "src/calc.test.ts" });
    expect(await policy.execute(sandbox, "apply_patch", { path: "src/calc.test.ts", oldText: "2", newText: "1" })).toMatchObject({ ok: false });
    expect(await policy.execute(sandbox, "apply_patch", { path: "src/calc.ts", oldText: "=> 1", newText: "=> 2" })).toMatchObject({ ok: true, data: { changed: true } });
    expect(await policy.execute(sandbox, "apply_patch", { path: "src/other.ts", oldText: "=> 1", newText: "=> 2" })).toMatchObject({ ok: false });
    expect(await policy.execute(sandbox, "apply_patch", { path: "src/calc.ts", oldText: "=> 2", newText: "=> 3" })).toMatchObject({ ok: true });
    expect(policy.changedFiles).toEqual(["src/calc.ts"]);
    expect(policy.rejectedScope).toBe(true);
    expect(await readFile(path.join(root, "src/other.ts"), "utf8")).toContain("=> 1");
  });

  it("preserves literal replacement dollar sequences and custom configured protected files", async () => {
    const policy = createStrictRepairPolicy({ projectRoot: root, allowedProductionFiles: ["src/calc.ts", "src/other.ts"], protectedPaths: ["src/other.ts"] });
    expect(await policy.execute(sandbox, "apply_patch", { path: "src/other.ts", oldText: "=> 1", newText: "=> 2" })).toMatchObject({ ok: false });
    expect(await policy.execute(sandbox, "apply_patch", { path: "src/calc.ts", oldText: "1", newText: "'$& $` $\u0027'" })).toMatchObject({ ok: true });
    expect(await readFile(path.join(root, "src/calc.ts"), "utf8")).toBe("export const calc = () => '$& $` $\u0027';\n");
  });

  it.each(["src/calc.test.ts", "src/calc.spec.ts", "tests/helper.ts", "src/__tests__/x.ts", "jest.config.ts", "vitest.setup.ts", "setupTests.ts", "scripts/check.ts", ".github/workflows/run.ts", "package.json", "pnpm-lock.yaml", "src/types.d.ts"])("rejects protected path %s", (file) => {
    expect(isProductionRepairPath(file)).toBe(false);
  });
});
