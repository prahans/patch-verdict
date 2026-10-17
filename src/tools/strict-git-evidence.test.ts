import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Sandbox } from "e2b";
vi.mock("../sandbox/e2b.js", () => ({
  runSandboxCommand: async (
    _sandbox: unknown,
    command: string,
    cwd: string,
  ) => {
    const encoded = /Buffer\.from\("([A-Za-z0-9+/=]+)","base64"\)/.exec(
      command,
    )?.[1];
    if (!encoded) throw new Error("Unexpected command");
    try {
      return {
        command,
        exitCode: 0,
        stdout: execFileSync(
          process.execPath,
          ["-e", Buffer.from(encoded, "base64").toString()],
          { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        ),
        stderr: "",
        durationMs: 1,
      };
    } catch (error) {
      const failed = error as {
        status: number;
        stdout: string;
        stderr: string;
      };
      return {
        command,
        exitCode: failed.status,
        stdout: String(failed.stdout ?? ""),
        stderr: String(failed.stderr ?? ""),
        durationMs: 1,
      };
    }
  },
}));
import {
  assertUntouchedRepository,
  captureStrictGitEvidence,
  frozenFileHash,
} from "./strict-git-evidence.js";
const sandbox = {} as Sandbox;
const directories: string[] = [];
const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), "pv-evidence-"));
  directories.push(root);
  git(root, ["init"]);
  git(root, ["config", "user.email", "fixture@example.invalid"]);
  git(root, ["config", "user.name", "Fixture"]);
  git(root, ["config", "core.autocrlf", "false"]);
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src/math.ts"), "export const value = 0;\n");
  await writeFile(
    path.join(root, "src/math.test.ts"),
    "existing repository test\n",
  );
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);
  return { root, base: git(root, ["rev-parse", "HEAD"]) };
}
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (
      path.dirname(directory) !== tmpdir() ||
      !path.basename(directory).startsWith("pv-evidence-")
    )
      throw new Error("Unsafe fixture cleanup");
    await rm(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
it("captures one registered generated test and production repair with exact final bytes", async () => {
  const { root, base } = await repository();
  await assertUntouchedRepository(sandbox, root, base);
  const generated = "src/regression.test.ts";
  const test = "test('specific issue', () => expect(value).toBe(1));\n";
  await writeFile(path.join(root, generated), test);
  await assertUntouchedRepository(sandbox, root, base, generated);
  await writeFile(path.join(root, "src/math.ts"), "export const value = 1;\n");
  const result = await captureStrictGitEvidence(sandbox, root, base, generated);
  expect(result.changedFiles.sort()).toEqual(["src/math.ts", generated].sort());
  expect(result.diff).toContain("new file mode 100644");
  expect(result.diff).toContain("+" + test.trim());
  expect(result.diff.endsWith("\n")).toBe(true);
  expect(await frozenFileHash(sandbox, root, generated)).toBe(
    createHash("sha256")
      .update(await readFile(path.join(root, generated)))
      .digest("hex"),
  );
  expect(git(root, ["rev-parse", "HEAD"])).toBe(base);
});
it("rejects unrelated untracked files, pre-repair modifications, and changed HEAD", async () => {
  const { root, base } = await repository();
  await writeFile(path.join(root, "stray.txt"), "untrusted");
  await expect(assertUntouchedRepository(sandbox, root, base)).rejects.toThrow(
    "integrity",
  );
  await rm(path.join(root, "stray.txt"));
  await writeFile(path.join(root, "src/math.ts"), "modified\n");
  await expect(assertUntouchedRepository(sandbox, root, base)).rejects.toThrow(
    "integrity",
  );
  await expect(
    captureStrictGitEvidence(sandbox, root, "a".repeat(40)),
  ).rejects.toThrow("HEAD changed");
});
it("hash detects frozen mutation and rejects path escapes", async () => {
  const { root } = await repository();
  const original = await frozenFileHash(sandbox, root, "src/math.test.ts");
  await writeFile(path.join(root, "src/math.test.ts"), "weakened test\n");
  expect(await frozenFileHash(sandbox, root, "src/math.test.ts")).not.toBe(
    original,
  );
  await expect(frozenFileHash(sandbox, root, "../outside")).rejects.toThrow();
});
