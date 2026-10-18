import type { Sandbox } from "e2b";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("../sandbox/e2b.js", () => ({ runSandboxCommand: mocks.run, readSandboxFile: mocks.read }));
import { cloneRepository } from "./clone.js";
import { prepareRepository } from "./prepare.js";

const sha = "a".repeat(40);
const sandbox = {} as Sandbox;
const request = { repositoryUrl: "https://github.com/owner/repo", mode: "THIRD_PARTY_JS_TS" as const, targetBranch: "release/2.x", expectedCommit: sha };
const ok = (command: string, stdout = "", exitCode = 0) => ({ command, stdout, stderr: "", exitCode, durationMs: 1 });
const tree = ["package.json", "package-lock.json", "src/divide.ts"].map((file) => `100644 blob ${sha}\t${file}\0`).join("");

beforeEach(() => {
  vi.resetAllMocks();
  mocks.run.mockImplementation(async (_sandbox, command: string) => ok(command, command === "git rev-parse HEAD" ? sha : command.startsWith("git ls-tree") ? tree : ""));
  mocks.read.mockResolvedValue(JSON.stringify({ packageManager: "npm@10", scripts: { test: "vitest run" }, devDependencies: { vitest: "3" } }));
});

describe("canonical strict checkout", () => {
  it("checks out only the exact SHA, retaining a shell-sensitive valid branch as metadata", async () => {
    const branch = "release/$(touch-here);'quoted'";
    const result = await cloneRepository(sandbox, { ...request, targetBranch: branch });
    expect(result).toMatchObject({ baseCommit: sha, targetBranch: branch });
    const commands = mocks.run.mock.calls.map((call) => call[1]);
    expect(commands).toContain(`git checkout --detach '${sha}'`);
    expect(commands.join("\n")).not.toContain(branch);
  });
  it("fetches a missing exact commit without re-resolving the moving branch", async () => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ok(command, command === "git rev-parse HEAD" ? sha : "", command.startsWith("git cat-file") ? 1 : 0));
    await cloneRepository(sandbox, request);
    expect(mocks.run.mock.calls.map((call) => call[1])).toContain(`git fetch --no-tags origin '${sha}'`);
  });
  it("rejects HEAD differing from canonical SHA", async () => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ok(command, command === "git rev-parse HEAD" ? "b".repeat(40) : ""));
    await expect(cloneRepository(sandbox, request)).rejects.toThrow("does not match");
  });
  it.each([{ expectedCommit: "main" }, { expectedCommit: "" }, { targetBranch: "" }, { ref: "main" }])("rejects incomplete canonical source %# before cloning", async (override) => {
    await expect(cloneRepository(sandbox, { ...request, ...override })).rejects.toThrow();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("rejects credential-bearing repository URLs", async () => {
    await expect(cloneRepository(sandbox, { ...request, repositoryUrl: "https://secret@github.com/owner/repo" })).rejects.toThrow("credentials");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("preserves legacy requested-ref checkout", async () => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ok(command, command.startsWith("git rev-parse") ? sha : ""));
    expect(await cloneRepository(sandbox, { repositoryUrl: request.repositoryUrl, ref: "release/2.x" })).toMatchObject({ requestedRef: "release/2.x", baseCommit: sha });
  });
});

describe("strict preparation integrity", () => {
  it("revalidates HEAD and clean tracked/untracked state after dependency install", async () => {
    expect(await prepareRepository(sandbox, request)).toMatchObject({ mode: "THIRD_PARTY_JS_TS", targetBranch: request.targetBranch, project: { projectKind: "single-package" } });
    expect(mocks.run.mock.calls.filter((call) => call[1] === "git rev-parse HEAD")).toHaveLength(2);
    expect(mocks.run.mock.calls.map((call) => call[1])).toContain("git status --porcelain --untracked-files=all");
  });
  it.each(["120000 blob", "160000 commit"])("rejects unsupported tree mode %s", async (mode) => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ok(command, command === "git rev-parse HEAD" ? sha : command.startsWith("git ls-tree") ? `${mode} ${sha}\tpackage.json\0` : command.includes("--untracked-files=all") ? "?? install-generated.js" : ""));
    await expect(prepareRepository(sandbox, request)).rejects.toMatchObject({ outcome: "UNSUPPORTED_REPOSITORY" });
  });
  it("reports preparation failure when installation changes tracked or untracked content", async () => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ok(command, command === "git rev-parse HEAD" ? sha : command.startsWith("git ls-tree") ? tree : command.includes("--untracked-files=all") ? " M package-lock.json\n?? install-generated.js" : ""));
    await expect(prepareRepository(sandbox, request)).rejects.toMatchObject({ outcome: "PREPARATION_FAILED" });
  });
  it("reports dependency installation failure as preparation, not reproduction", async () => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ok(command, command === "git rev-parse HEAD" ? sha : command.startsWith("git ls-tree") ? tree : "", command.startsWith("npm ci") ? 1 : 0));
    await expect(prepareRepository(sandbox, request)).rejects.toMatchObject({ outcome: "PREPARATION_FAILED" });
  });
});
