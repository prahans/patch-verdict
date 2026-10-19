import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, link, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  expect(git(root, ["ls-files", "--", generated])).toBe("");
  expect((await captureStrictGitEvidence(sandbox, root, base, generated)).diff).toBe(result.diff);
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

it.each(["--assume-unchanged", "--skip-worktree"])(
  "rejects %s index flags even when ordinary Git diff hides an edited test",
  async (flag) => {
    const { root, base } = await repository();
    git(root, ["update-index", flag, "--", "src/math.test.ts"]);
    await writeFile(path.join(root, "src/math.test.ts"), "silently weakened test\n");
    expect(git(root, ["diff", "HEAD", "--name-only"])).toBe("");
    await expect(assertUntouchedRepository(sandbox, root, base)).rejects.toThrow("hidden");
    await expect(captureStrictGitEvidence(sandbox, root, base)).rejects.toThrow("hidden");
  },
);

it("rejects staged index changes instead of treating them as the trusted base", async () => {
  const { root, base } = await repository();
  await writeFile(path.join(root, "src/math.ts"), "export const value = 1;\n");
  git(root, ["add", "src/math.ts"]);
  await expect(captureStrictGitEvidence(sandbox, root, base)).rejects.toThrow("index changed");
});

it("detects and captures raw CRLF changes that Git text normalization hides", async () => {
  const { root } = await repository();
  await writeFile(path.join(root, ".gitattributes"), "*.ts text\n");
  git(root, ["add", ".gitattributes"]);
  git(root, ["commit", "-m", "text attributes"]);
  const base = git(root, ["rev-parse", "HEAD"]);
  await assertUntouchedRepository(sandbox, root, base);
  const changed = "export const value = 0;\r\n";
  await writeFile(path.join(root, "src/math.ts"), changed);
  expect(git(root, ["diff", "HEAD", "--name-only"])).toBe("");
  await expect(assertUntouchedRepository(sandbox, root, base)).rejects.toThrow("changed before repair");
  const proof = await captureStrictGitEvidence(sandbox, root, base);
  expect(proof.changedFiles).toEqual(["src/math.ts"]);
  expect(proof.diff).toContain("+" + changed);
  await writeFile(path.join(root, "src/math.ts"), "export const value = 0;\n");
  execFileSync("git", ["apply", "--whitespace=nowarn", "-"], {
    cwd: root,
    input: proof.diff,
    stdio: ["pipe", "pipe", "pipe"],
  });
  expect(await readFile(path.join(root, "src/math.ts"), "utf8")).toBe(changed);
});

it.each([
  ["core.ignoreStat", "true"],
  ["core.fsmonitor", "echo filter-ran > filter-marker"],
  ["diff.external", "echo filter-ran > filter-marker"],
  ["filter.fixture.clean", "echo filter-ran > filter-marker"],
  ["include.path", "../untrusted-config"],
])("rejects local %s configuration without executing it", async (key, value) => {
  const { root, base } = await repository();
  git(root, ["config", key!, value!]);
  await expect(captureStrictGitEvidence(sandbox, root, base)).rejects.toThrow("Unsupported Git configuration");
  await expect(readFile(path.join(root, "filter-marker"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["filter=fixture", "working-tree-encoding=UTF-16", "ident"])(
  "rejects transforming %s attributes before producing evidence",
  async (attribute) => {
    const { root, base } = await repository();
    // Leave attributes untracked to avoid invoking an encoding or clean filter
    // while constructing the adversarial fixture. The file is registered only
    // so the untracked-file check cannot mask the attribute check under test.
    await writeFile(path.join(root, ".gitattributes"), "*.ts " + attribute + "\n");
    await expect(captureStrictGitEvidence(sandbox, root, base, ".gitattributes")).rejects.toThrow("Unsupported Git attribute");
  },
);

it.each(["attributes", "exclude"])("rejects .git/info/%s overrides", async (name) => {
  const { root, base } = await repository();
  await writeFile(path.join(root, ".git", "info", name), "*.ts\n");
  await expect(captureStrictGitEvidence(sandbox, root, base)).rejects.toThrow("Git info overrides");
});

it("rejects a registered generated path that existed at the selected base", async () => {
  const { root, base } = await repository();
  await expect(captureStrictGitEvidence(sandbox, root, base, "src/math.test.ts")).rejects.toThrow("must be a new safe path");
});

it("rejects hard-linked tracked files and non-text candidate bytes", async () => {
  const { root, base } = await repository();
  const linked = path.join(root, "linked.ts");
  await link(path.join(root, "src/math.ts"), linked);
  await expect(captureStrictGitEvidence(sandbox, root, base, "linked.ts")).rejects.toThrow("Unsupported tracked file");
  await rm(linked);
  await writeFile(path.join(root, "src/math.ts"), Buffer.from([0xff, 0xfe]));
  await expect(captureStrictGitEvidence(sandbox, root, base)).rejects.toThrow("Unsupported changed file bytes");
});

it.skipIf(process.platform === "win32")("rejects executable-mode changes even when core.fileMode hides them", async () => {
  const { root, base } = await repository();
  git(root, ["config", "core.fileMode", "false"]);
  await chmod(path.join(root, "src/math.ts"), 0o755);
  expect(git(root, ["diff", "HEAD", "--name-only"])).toBe("");
  await expect(captureStrictGitEvidence(sandbox, root, base)).rejects.toThrow("file mode changed");
});
