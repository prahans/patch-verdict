import type { Sandbox } from "e2b";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandEvidence } from "../evidence/command-evidence.js";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const mocks = vi.hoisted(() => ({ run: vi.fn(), read: vi.fn() }));
vi.mock("../sandbox/e2b.js", () => ({ runSandboxCommand: mocks.run, readSandboxFile: mocks.read }));
import { createFrameworkAdapter, parseFrameworkReport } from "./framework-adapter.js";

const projectRoot = "/tmp/patchverdict";
const identity = { testPath: "src/divide.test.ts", testIdentity: "divide rejects zero" };
const evidence = (exitCode = 1, stderr = ""): CommandEvidence => ({ command: "trusted framework command", exitCode, stdout: "", stderr, durationMs: 1 });
const assertion = (status = "failed", fullName = identity.testIdentity, message = "expected Infinity to be 0") => ({ fullName, status, failureMessages: status === "failed" ? [message] : [] });
const report = (assertions = [assertion()]) => ({
  success: !assertions.some((test) => test.status === "failed"), numTotalTests: assertions.length,
  numFailedTests: assertions.filter((test) => test.status === "failed").length,
  numPassedTests: assertions.filter((test) => test.status === "passed").length,
  testResults: [{ name: `${projectRoot}/${identity.testPath}`, status: assertions.some((test) => test.status === "failed") ? "failed" : "passed", message: "", assertionResults: assertions }],
});

beforeEach(() => { vi.resetAllMocks(); });

describe("framework result normalization", () => {
  it("requires a real case failure and retains exact identities", () => {
    expect(parseFrameworkReport(JSON.stringify(report()), evidence(), projectRoot, identity)).toMatchObject({ execution: "COMPLETED", errorKind: "TARGET_TEST_FAILURE", failed: [{ ...identity, message: "expected Infinity to be 0" }] });
  });
  it("normalizes passes, unrelated failures, and skipped discovered cases separately", () => {
    const result = parseFrameworkReport(JSON.stringify(report([assertion("passed"), assertion("failed", "unrelated failure"), assertion("pending", "skipped case")])), evidence(), projectRoot);
    expect(result.execution).toBe("COMPLETED");
    expect(result.discovered).toHaveLength(3);
    expect(result.passed).toEqual([identity]);
    expect(result.failed[0]?.testIdentity).toBe("unrelated failure");
  });
  it.each(["TypeError: attempted operation on undefined", "SyntaxError: Unexpected token in JSON", "expected TypeScript value to equal JavaScript value"])("accepts executed application behavior: %s", (message) => {
    expect(parseFrameworkReport(JSON.stringify(report([assertion("failed", identity.testIdentity, message)])), evidence(), projectRoot, identity).execution).toBe("COMPLETED");
  });
  it.each([
    ["Cannot find module './missing'", "MODULE_RESOLUTION_ERROR"],
    ["TS2307: missing type", "TEST_COMPILE_ERROR"],
    ["Test timed out after 1000ms", "TIMEOUT"],
  ])("rejects invalid/incomplete target failures: %s", (message, kind) => {
    expect(parseFrameworkReport(JSON.stringify(report([assertion("failed", identity.testIdentity, message)])), evidence(), projectRoot).errorKind).toBe(kind);
  });
  it.each([
    "Error: connect ECONNREFUSED 127.0.0.1:5432",
    "Error: getaddrinfo ENOTFOUND database.internal",
    "Error: DNS lookup failed for required service",
    "Error: EAI_AGAIN database.internal",
    "Error: required service postgres is unavailable",
    "Error: missing required database",
    "Error: Redis is not running",
    "Cannot connect to the Docker daemon at unix:///var/run/docker.sock",
    "Error: Missing required environment variable DATABASE_URL",
    "Error: environment variable DATABASE_URL must be set",
    "Error: missing secret DATABASE_PASSWORD",
    "Error: secret DATABASE_PASSWORD was not provided",
    "Error: API key is required",
  ])("does not accept an executed prerequisite failure as target reproduction: %s", (message) => {
    expect(parseFrameworkReport(JSON.stringify(report([assertion("failed", identity.testIdentity, message)])), evidence(), projectRoot, identity)).toMatchObject({ execution: "ERROR", errorKind: "INFRASTRUCTURE_ERROR", discovered: [], passed: [], failed: [] });
  });
  it.each([
    ["SyntaxError: Unexpected token", "TEST_PARSE_ERROR"],
    ["transform failed TS1234", "TEST_COMPILE_ERROR"],
    ["Cannot find module x", "MODULE_RESOLUTION_ERROR"],
    ["Validation Error: configuration invalid", "CONFIGURATION_ERROR"],
    ["Startup Error: failed to start", "FRAMEWORK_STARTUP_ERROR"],
  ])("does not mistake suite startup failure for reproduction: %s", (message, kind) => {
    const value = { ...report([]), success: false, testResults: [{ name: `${projectRoot}/src/bad.test.ts`, status: "failed", message, assertionResults: [] }] };
    expect(parseFrameworkReport(JSON.stringify(value), evidence(), projectRoot)).toMatchObject({ execution: "ERROR", errorKind: kind, failed: [] });
  });
  it("rejects a target command that executed another case or multiple cases", () => {
    expect(parseFrameworkReport(JSON.stringify(report([assertion("failed", "different")])), evidence(), projectRoot, identity).execution).toBe("ERROR");
    expect(parseFrameworkReport(JSON.stringify(report([assertion(), assertion("passed", "different")])), evidence(), projectRoot, identity).execution).toBe("ERROR");
  });
  it("rejects skipped target, no tests, duplicate identities, unknown statuses, and unbounded output", () => {
    for (const value of [report([]), report([assertion("pending")]), report([assertion(), assertion()]), report([assertion("mystery")])]) {
      expect(parseFrameworkReport(JSON.stringify(value), evidence(), projectRoot).execution).toBe("ERROR");
    }
    expect(parseFrameworkReport("x".repeat(4_000_001), evidence(), projectRoot).execution).toBe("ERROR");
  });
  it("rejects inconsistent totals, exit code, reported success, and escaping paths", () => {
    const values = [{ ...report(), numTotalTests: 2 }, { ...report(), success: true }, { ...report(), testResults: [{ ...report().testResults[0], name: "/etc/escape.test.ts" }] }];
    for (const value of values) expect(parseFrameworkReport(JSON.stringify(value), evidence(), projectRoot).execution).toBe("ERROR");
    expect(parseFrameworkReport(JSON.stringify(report()), evidence(0), projectRoot).execution).toBe("ERROR");
  });
  it("bounds retained command output", () => {
    const result = parseFrameworkReport(JSON.stringify(report()), { ...evidence(), stdout: "x".repeat(100_000) }, projectRoot);
    expect(result.evidence.stdout.length).toBe(32_000);
  });
});

describe("framework command execution", () => {
  it.each(["vitest", "jest"] as const)("uses installed %s without fetching and preserves exact command", (framework) => {
    const adapter = createFrameworkAdapter(framework, projectRoot);
    const target = { testPath: "src/a'$file.test.ts", testIdentity: "a [literal].* $(x); 'quote'" };
    const command = adapter.command(target);
    expect(command).toBe(adapter.command(target));
    expect(command).toContain(`/node_modules/${framework}/`);
    expect(command).not.toMatch(/\bnpx\b|\bpnpm dlx\b/);
    expect(command).toContain("--testNamePattern=^");
    expect(command).toContain("\\[literal\\]\\.\\*");
    expect(command).toContain("'\\''");
    expect(command).toContain("--outputFile=/tmp/patchverdict-report-");
    if (framework === "jest") expect(command).toContain("--runTestsByPath");
  });
  it.each(["../bad.test.ts", "/etc/bad.test.ts", ".git/config", "a\\bad.test.ts", "--help"])("rejects unsafe exact test path %s", (testPath) => {
    expect(() => createFrameworkAdapter("vitest", projectRoot).command({ ...identity, testPath })).toThrow();
  });
  it("removes stale report before execution and validates size before reading", async () => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ({ ...evidence(command.includes("vitest.mjs") ? 1 : 0), command }));
    mocks.read.mockResolvedValue(JSON.stringify(report()));
    const adapter = createFrameworkAdapter("vitest", projectRoot);
    expect((await adapter.run({} as Sandbox, identity)).execution).toBe("COMPLETED");
    const commands = mocks.run.mock.calls.map((call) => call[1] as string);
    expect(commands[0]).toContain("rmSync");
    expect(commands[1]).toBe(adapter.command(identity));
    expect(commands[2]).toContain("lstatSync");
    expect(commands[3]).toContain("rmSync");
    expect(mocks.read.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.run.mock.invocationCallOrder[2]!);
  });
  it("refuses oversized/missing/symlink reports before transport", async () => {
    mocks.run.mockImplementation(async (_sandbox, command: string) => ({ ...evidence(command.includes("lstatSync") ? 1 : 0), command }));
    expect((await createFrameworkAdapter("jest", projectRoot).run({} as Sandbox)).execution).toBe("ERROR");
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("does not run tests if old report cannot be removed", async () => {
    mocks.run.mockResolvedValue(evidence());
    expect((await createFrameworkAdapter("vitest", projectRoot).run({} as Sandbox)).execution).toBe("ERROR");
    expect(mocks.run.mock.calls.every((call) => String(call[1]).includes("rmSync"))).toBe(true);
    expect(mocks.read).not.toHaveBeenCalled();
  });
});

describe("repository-local Vitest fixture", () => {
  it("normalizes real failure/pass JSON while retaining unrelated background failure", () => {
    const fixtureParent = path.resolve("output");
    fs.mkdirSync(fixtureParent, { recursive: true });
    const fixture = fs.mkdtempSync(path.join(fixtureParent, "adapter-fixture-"));
    const artifact = path.join(fixtureParent, `${path.basename(fixture)}.json`);
    const binary = path.resolve("node_modules/vitest/vitest.mjs");
    try {
      fs.writeFileSync(path.join(fixture, "package.json"), JSON.stringify({ type: "module" }));
      fs.writeFileSync(path.join(fixture, "divide.js"), "export const divide = (a,b) => a/b;\n");
      fs.writeFileSync(path.join(fixture, "divide.test.js"), "import {test,expect} from 'vitest';\nimport {divide} from './divide.js';\ntest('target zero',()=>expect(divide(1,0)).toBe(0));\ntest('background',()=>expect(2).toBe(3));\n");
      function execute(targetName?: string) {
        fs.rmSync(artifact, { force: true });
        const args = [binary, "run", "--root", fixture, "--reporter=json", `--outputFile=${artifact}`, ...(targetName ? [`--testNamePattern=^${targetName}$`] : [])];
        const started = Date.now();
        const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: fixture, timeout: 20_000, maxBuffer: 1_000_000, windowsHide: true });
        if (result.error) throw result.error;
        expect(fs.existsSync(artifact), result.stderr).toBe(true);
        const json = JSON.parse(fs.readFileSync(artifact, "utf8"));
        // The production sandbox is POSIX. Translate only host-specific file
        // prefixes; all test identities, statuses, counts and messages are real.
        for (const suite of json.testResults) suite.name = `${projectRoot}/${path.relative(fixture, suite.name).replace(/\\/g, "/")}`;
        return parseFrameworkReport(JSON.stringify(json), { command: args.join(" "), exitCode: result.status ?? -1, stdout: result.stdout, stderr: result.stderr, durationMs: Date.now() - started }, projectRoot, targetName ? { testPath: "divide.test.js", testIdentity: targetName } : undefined);
      }
      const before = execute();
      expect(before.execution, JSON.stringify(before)).toBe("COMPLETED");
      expect(before.failed.map((test) => test.testIdentity).sort()).toEqual(["background", "target zero"]);
      expect(execute("target zero").failed).toHaveLength(1);
      fs.writeFileSync(path.join(fixture, "divide.js"), "export const divide = (a,b) => b === 0 ? 0 : a/b;\n");
      const after = execute();
      expect(after.execution).toBe("COMPLETED");
      expect(after.failed.map((test) => test.testIdentity)).toEqual(["background"]);
      expect(after.passed.map((test) => test.testIdentity)).toEqual(["target zero"]);
      expect(execute("target zero")).toMatchObject({ execution: "COMPLETED", failed: [], passed: [{ testPath: "divide.test.js", testIdentity: "target zero" }] });
    } finally {
      const resolved = path.resolve(fixture);
      if (path.dirname(resolved) !== fixtureParent || !path.basename(resolved).startsWith("adapter-fixture-")) throw new Error("Unsafe fixture cleanup path.");
      fs.rmSync(resolved, { recursive: true, force: true });
      fs.rmSync(artifact, { force: true });
    }
  }, 90_000);
});
