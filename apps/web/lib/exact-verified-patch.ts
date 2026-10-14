import "server-only";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isUtf8 } from "node:buffer";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type GitHubRequest = (endpoint: string, method?: string, body?: unknown, allowMissing?: boolean) => Promise<unknown>;
type Entry = { path: string; mode: string; sha: string };
export type ExactPatch = { baseTree: string; treeSha: string; entries: Array<Entry & { contents: Buffer | null }> };

export class PullRequestError extends Error {
  status: number;
  constructor(message: string, status = 409) { super(message); this.name = "PullRequestError"; this.status = status; }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new PullRequestError("GitHub returned an invalid response.", 502);
  return value as Record<string, unknown>;
}

export function gitSha(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/.test(value)) throw new PullRequestError("GitHub returned an invalid Git object.", 502);
  return value;
}

export function safePatchPath(value: string): boolean {
  return value.length > 0 && value.length <= 500 && !/[\\\x00-\x1f\x7f:]/.test(value) &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." &&
      !/^\.git(?:$|\.)/i.test(part) && !/[. ]$/.test(part));
}

function supported(entry: Entry) {
  if (!["100644", "100755"].includes(entry.mode)) {
    throw new PullRequestError("Pull request publication supports regular text files only; symlinks, submodules, and other file modes are not supported.");
  }
}

function textBlob(bytes: Buffer) {
  if (bytes.length > 2 * 1024 * 1024 || bytes.includes(0) || !isUtf8(bytes)) {
    throw new PullRequestError("Pull request publication supports bounded UTF-8 text files only. Binary or oversized files cannot be published.");
  }
}

// No inherited Git configuration, credentials, hooks, filters, shell, or worktree.
// Only Git's index and object database are used; repository code is never executed.
function gitRunner(directory: string) {
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEMP: process.env.TEMP, TMP: process.env.TMP,
    HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: directory,
    GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(directory, "empty-config"),
    GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
  return (args: string[], input?: Buffer | string): Promise<Buffer> => new Promise((resolve, reject) => {
    const child = spawn("git", ["-c", `core.hooksPath=${path.join(directory, "empty")}`,
      "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "-c", "core.quotePath=false", ...args],
    { cwd: directory, env: environment, shell: false, windowsHide: true, stdio: "pipe" });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    const fail = () => { if (!failed) { failed = true; child.kill(); reject(new PullRequestError("The exact recorded patch could not be validated with Git.")); } };
    const timer = setTimeout(fail, 20000);
    child.on("error", fail);
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 12 * 1024 * 1024) fail(); else chunks.push(chunk); });
    // Never retain or expose child stderr: it may contain untrusted patch text.
    child.stderr.on("data", (chunk: Buffer) => { size += chunk.length; if (size > 12 * 1024 * 1024) fail(); });
    child.on("close", (code) => { clearTimeout(timer); if (code !== 0) fail(); else if (!failed) resolve(Buffer.concat(chunks)); });
    child.stdin.end(input);
  });
}

export async function prepareExactPatch(api: GitHubRequest, baseCommit: string, changedFiles: string[], patch: Buffer): Promise<ExactPatch> {
  gitSha(baseCommit);
  if (!changedFiles.length || changedFiles.length > 200 || new Set(changedFiles).size !== changedFiles.length || changedFiles.some((file) => !safePatchPath(file))) {
    throw new PullRequestError("The proof contains an unsupported or invalid changed-file set.");
  }
  if (patch.length > 2 * 1024 * 1024 || !isUtf8(patch) || patch.includes(0) || /^(GIT binary patch|Binary files .* differ)$/m.test(patch.toString("utf8"))) {
    throw new PullRequestError("Binary, invalid, or oversized patches cannot be published.");
  }
  const commit = record(await api(`/git/commits/${baseCommit}`));
  if (gitSha(commit.sha) !== baseCommit) throw new PullRequestError("The proof base commit could not be confirmed.");
  const baseTree = gitSha(record(commit.tree).sha);
  const tree = record(await api(`/git/trees/${baseTree}?recursive=1`));
  if (tree.sha !== baseTree || tree.truncated !== false || !Array.isArray(tree.tree) || tree.tree.length > 20000) {
    throw new PullRequestError("The repository tree is incomplete or too large for exact patch publication.");
  }
  const base = new Map<string, Entry>();
  const seen = new Set<string>();
  for (const item of tree.tree) {
    const entry = record(item);
    if (typeof entry.path !== "string" || !safePatchPath(entry.path) || seen.has(entry.path.toLowerCase())) {
      throw new PullRequestError("The repository contains unsupported or ambiguous file paths.");
    }
    seen.add(entry.path.toLowerCase());
    if (entry.type === "tree" && entry.mode === "040000") continue;
    if (typeof entry.mode !== "string" || !["100644", "100755", "120000", "160000"].includes(entry.mode) ||
      (entry.mode === "160000" ? entry.type !== "commit" : entry.type !== "blob")) {
      throw new PullRequestError("The repository contains unsupported Git tree entries.");
    }
    base.set(entry.path, { path: entry.path, mode: entry.mode, sha: gitSha(entry.sha) });
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), "patchverdict-pr-"));
  try {
    await mkdir(path.join(directory, "empty"));
    await writeFile(path.join(directory, "empty-config"), "");
    const git = gitRunner(directory);
    await git(["init", "--bare", `--template=${path.join(directory, "empty")}`, "."]);
    await git(["update-index", "-z", "--index-info"], [...base.values()].map((entry) => `${entry.mode} ${entry.sha}\t${entry.path}\0`).join(""));
    if ((await git(["write-tree", "--missing-ok"])).toString().trim() !== baseTree) {
      throw new PullRequestError("The repository tree does not match the proof base commit.");
    }
    let bytesRead = 0;
    for (const file of changedFiles) {
      const entry = base.get(file);
      if (!entry) continue;
      supported(entry);
      const blob = record(await api(`/git/blobs/${entry.sha}`));
      if (blob.encoding !== "base64" || typeof blob.content !== "string" || gitSha(blob.sha) !== entry.sha) {
        throw new PullRequestError("GitHub returned an invalid base file.", 502);
      }
      const contents = Buffer.from(blob.content, "base64");
      textBlob(contents);
      bytesRead += contents.length;
      if (bytesRead > 8 * 1024 * 1024) throw new PullRequestError("The patch is too large for publication.");
      if ((await git(["hash-object", "-w", "--stdin"], contents)).toString().trim() !== entry.sha) {
        throw new PullRequestError("The base file does not match its recorded Git object.", 502);
      }
    }
    await git(["apply", "--cached", "--check", "--whitespace=nowarn", "-"], patch);
    await git(["apply", "--cached", "--whitespace=nowarn", "-"], patch);
    const result = new Map<string, Entry>();
    for (const line of (await git(["ls-files", "--stage", "-z"])).toString("utf8").split("\0").filter(Boolean)) {
      const match = /^(\d{6}) ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(line);
      if (!match || !safePatchPath(match[3])) throw new PullRequestError("The resulting patch has invalid file paths.");
      result.set(match[3], { mode: match[1], sha: match[2], path: match[3] });
    }
    const actual = [...new Set([...base.keys(), ...result.keys()])].filter((file) => base.get(file)?.sha !== result.get(file)?.sha || base.get(file)?.mode !== result.get(file)?.mode).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...changedFiles].sort())) {
      throw new PullRequestError("The patch changed-file set does not match the canonical proof.");
    }
    const entries: ExactPatch["entries"] = [];
    for (const file of actual) {
      const before = base.get(file);
      const after = result.get(file);
      if (before) supported(before);
      if (after) supported(after);
      const contents = after ? await git(["cat-file", "blob", after.sha]) : null;
      if (contents) textBlob(contents);
      entries.push({ path: file, mode: after?.mode ?? before!.mode, sha: after?.sha ?? before!.sha, contents });
    }
    const treeSha = (await git(["write-tree", "--missing-ok"])).toString().trim();
    return { baseTree, treeSha: gitSha(treeSha), entries };
  } finally {
    // mkdtemp returns our own unique direct child; never follow a persisted path.
    if (path.dirname(directory) === os.tmpdir() && path.basename(directory).startsWith("patchverdict-pr-")) {
      await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
}

export function patchDigest(patch: Buffer) { return createHash("sha256").update(patch).digest("hex"); }
