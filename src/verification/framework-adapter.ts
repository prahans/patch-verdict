import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Sandbox } from "e2b";
import { readSandboxFile, runSandboxCommand } from "../sandbox/e2b.js";
import type { CommandEvidence } from "../evidence/command-evidence.js";
import type {
  FrameworkErrorKind,
  NormalizedRun,
  TestIdentity,
} from "../mission/third-party-types.js";

const MAX_REPORT_BYTES = 4_000_000;
const MAX_TESTS = 10_000;
const MAX_OUTPUT = 32_000;
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const escapeRegex = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const key = (identity: TestIdentity) =>
  JSON.stringify([identity.testPath, identity.testIdentity]);

function boundedEvidence(evidence: CommandEvidence): CommandEvidence {
  return {
    ...evidence,
    stdout: evidence.stdout.slice(-MAX_OUTPUT),
    stderr: evidence.stderr.slice(-MAX_OUTPUT),
  };
}

function classifyError(text: string): FrameworkErrorKind | undefined {
  if (
    /\btimed?\s*out\b|\bTimeoutError\b|\btimeout(?:\s+of|\s*:)|\bETIMEDOUT\b/i.test(
      text,
    )
  )
    return "TIMEOUT";
  if (/no tests? (?:found|files? found)|no test files found/i.test(text))
    return "NO_TESTS_FOUND";
  if (
    /cannot find (?:module|package)|module not found|ERR_MODULE_NOT_FOUND|failed to (?:resolve|load) (?:import|url)|could not resolve|cannot resolve module/i.test(
      text,
    )
  )
    return "MODULE_RESOLUTION_ERROR";
  if (
    /\bTS\d{4}\b|transform failed|compilation failed|failed to compile|TSError/i.test(
      text,
    )
  )
    return "TEST_COMPILE_ERROR";
  if (
    /SyntaxError|unexpected token|parse error|failed to parse|unterminated/i.test(
      text,
    )
  )
    return "TEST_PARSE_ERROR";
  if (
    /config(?:uration)? error|validation error|failed to load config|unknown option|unknown argument/i.test(
      text,
    )
  )
    return "CONFIGURATION_ERROR";
  if (/startup error|failed to start|worker.*exited|worker.*crash/i.test(text))
    return "FRAMEWORK_STARTUP_ERROR";
  if (
    /\b(?:ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ENOTFOUND|EAI_AGAIN)\b|\bgetaddrinfo\b|\bDNS\s+(?:lookup\s+)?(?:failed|failure|error)\b/i.test(text) ||
    /\b(?:missing|unavailable)\s+(?:(?:a|the)\s+)?(?:required\s+)?(?:database|service|docker\s+daemon)\b|\b(?:required\s+)?(?:database|service|redis|postgres(?:ql)?|mysql|mongodb|docker\s+daemon)\b[^\r\n]{0,120}\b(?:unavailable|unreachable|not\s+(?:running|available|configured))\b|cannot connect to the Docker daemon/i.test(text) ||
    /\b(?:missing|unset|undefined|unavailable)\s+(?:(?:a|the)\s+)?(?:required\s+)?(?:environment\s+variables?|env\s+vars?|secrets?|credentials?|api[_ -]?keys?)\b/i.test(text) ||
    /\b(?:environment\s+variables?|env\s+vars?|secrets?|credentials?|api[_ -]?keys?)\b[^\r\n]{0,120}\b(?:missing|unset|undefined|unavailable|not\s+(?:set|configured|provided|found)|must\s+be\s+(?:set|provided)|required)\b/i.test(text)
  )
    return "INFRASTRUCTURE_ERROR";
  // An unclassified exception inside an executed assertion may be application
  // behavior. Keep it distinct from a recognized unavailable prerequisite.
  return undefined;
}

function errorRun(
  evidence: CommandEvidence,
  errorKind: FrameworkErrorKind | undefined,
): NormalizedRun {
  return {
    execution: "ERROR",
    errorKind: errorKind ?? "INFRASTRUCTURE_ERROR",
    discovered: [],
    passed: [],
    failed: [],
    evidence: boundedEvidence(evidence),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeTestPath(
  value: string,
  projectRoot: string,
): string | undefined {
  const relative = path.posix.isAbsolute(value)
    ? path.posix.relative(projectRoot, value)
    : value.replace(/^\.\//, "");
  if (
    !relative ||
    relative.length > 500 ||
    relative.startsWith("-") ||
    /[\0\r\n\\]/.test(relative) ||
    path.posix.isAbsolute(relative) ||
    relative
      .split("/")
      .some((part) => part === ".." || part === ".git" || !part)
  )
    return undefined;
  return relative;
}

/** Vitest's JSON reporter uses Jest's result shape. Unknown output fails closed. */
export function parseFrameworkReport(
  json: string,
  evidence: CommandEvidence,
  projectRoot: string,
  target?: TestIdentity,
): NormalizedRun {
  const fallback = () =>
    errorRun(evidence, classifyError(`${evidence.stderr}\n${evidence.stdout}`));
  if (Buffer.byteLength(json, "utf8") > MAX_REPORT_BYTES)
    return errorRun(evidence, "INFRASTRUCTURE_ERROR");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return fallback();
  }
  const root = record(parsed);
  if (
    !root ||
    !Array.isArray(root.testResults) ||
    root.testResults.length > MAX_TESTS ||
    typeof root.numTotalTests !== "number" ||
    !Number.isSafeInteger(root.numTotalTests) ||
    root.numTotalTests < 0 ||
    root.numTotalTests > MAX_TESTS
  )
    return fallback();
  const result: NormalizedRun = {
    execution: "COMPLETED",
    discovered: [],
    passed: [],
    failed: [],
    evidence: boundedEvidence(evidence),
  };
  const seen = new Set<string>();
  const suiteErrors: string[] = [];
  let unknown = false;
  for (const value of root.testResults) {
    const suite = record(value);
    if (
      !suite ||
      typeof suite.name !== "string" ||
      !Array.isArray(suite.assertionResults)
    )
      return fallback();
    const testPath = normalizeTestPath(suite.name, projectRoot);
    if (!testPath) return errorRun(evidence, "INFRASTRUCTURE_ERROR");
    if (
      suite.testExecError ||
      (suite.status === "failed" && suite.assertionResults.length === 0)
    ) {
      suiteErrors.push(
        typeof suite.message === "string" && suite.message
          ? suite.message.slice(0, MAX_OUTPUT)
          : (
              JSON.stringify(suite.testExecError) ??
              "Framework suite failed before running tests."
            ).slice(0, MAX_OUTPUT),
      );
    }
    for (const value of suite.assertionResults) {
      const assertion = record(value);
      if (
        !assertion ||
        typeof assertion.fullName !== "string" ||
        !assertion.fullName.trim() ||
        assertion.fullName.length > 2000 ||
        /\0/.test(assertion.fullName)
      )
        return fallback();
      const identity = { testPath, testIdentity: assertion.fullName };
      if (seen.has(key(identity)) || seen.size >= MAX_TESTS)
        return errorRun(evidence, "INFRASTRUCTURE_ERROR");
      seen.add(key(identity));
      result.discovered.push(identity);
      if (assertion.status === "passed") result.passed.push(identity);
      else if (assertion.status === "failed") {
        if (
          !Array.isArray(assertion.failureMessages) ||
          assertion.failureMessages.some(
            (message) => typeof message !== "string",
          )
        )
          return fallback();
        const message = (assertion.failureMessages as string[])
          .join("\n")
          .slice(0, 8000);
        const failureKind = classifyError(message);
        // Legitimate application runtime exceptions are target failures, but
        // invalid tests/imports/framework startup cannot earn reproduction.
        // Parse-time failures are reported at suite level. An actually executed
        // test may legitimately expose an application SyntaxError (JSON.parse,
        // for example); do not mistake that behavior for a malformed test.
        if (
          failureKind !== undefined &&
          failureKind !== "TEST_PARSE_ERROR"
        )
          return errorRun(evidence, failureKind);
        result.failed.push({ ...identity, message });
      } else if (
        !["pending", "skipped", "todo", "disabled"].includes(
          String(assertion.status),
        )
      )
        unknown = true;
    }
  }
  if (suiteErrors.length)
    return errorRun(evidence, classifyError(suiteErrors.join("\n")));
  if (
    unknown ||
    result.discovered.length !== root.numTotalTests ||
    (typeof root.numFailedTests === "number" &&
      root.numFailedTests !== result.failed.length) ||
    (typeof root.numPassedTests === "number" &&
      root.numPassedTests !== result.passed.length) ||
    (typeof root.numRuntimeErrorTestSuites === "number" &&
      root.numRuntimeErrorTestSuites > 0)
  )
    return errorRun(evidence, "INFRASTRUCTURE_ERROR");
  if (
    !result.discovered.length ||
    (!result.passed.length && !result.failed.length)
  )
    return errorRun(evidence, "NO_TESTS_FOUND");
  if (target) {
    const executed = [...result.passed, ...result.failed];
    if (executed.length !== 1 || key(executed[0]!) !== key(target))
      return errorRun(evidence, "NO_TESTS_FOUND");
  }
  if (
    evidence.exitCode !== (result.failed.length ? 1 : 0) ||
    root.success !== (result.failed.length === 0)
  )
    return fallback();
  if (result.failed.length) result.errorKind = "TARGET_TEST_FAILURE";
  return result;
}

export function createFrameworkAdapter(
  framework: "vitest" | "jest",
  projectRoot: string,
) {
  if (!path.posix.isAbsolute(projectRoot) || /[\0\r\n]/.test(projectRoot))
    throw new Error("Invalid project root.");
  const report = `/tmp/patchverdict-report-${randomUUID()}.json`;
  const executable = path.posix.join(
    projectRoot,
    "node_modules",
    framework === "vitest" ? "vitest/vitest.mjs" : "jest/bin/jest.js",
  );
  function command(target?: TestIdentity): string {
    if (
      target &&
      (!normalizeTestPath(target.testPath, projectRoot) ||
        normalizeTestPath(target.testPath, projectRoot) !== target.testPath ||
        !target.testIdentity.trim() ||
        target.testIdentity.length > 2000 ||
        /\0/.test(target.testIdentity))
    )
      throw new Error("Invalid exact test selection.");
    const args =
      framework === "vitest"
        ? ["run", "--reporter=json", `--outputFile=${report}`]
        : ["--runInBand", "--watch=false", "--json", `--outputFile=${report}`];
    if (target) {
      args.push(`--testNamePattern=^${escapeRegex(target.testIdentity)}$`);
      if (framework === "jest") args.push("--runTestsByPath");
      else args.push("--");
      args.push(path.posix.join(projectRoot, target.testPath));
    }
    return ["node", quote(executable), ...args.map(quote)].join(" ");
  }
  async function removeReport(sandbox: Sandbox) {
    const script = `require('fs').rmSync(${JSON.stringify(report)}, {force:true})`;
    const result = await runSandboxCommand(
      sandbox,
      `node -e ${quote(script)}`,
      "/tmp",
    );
    if (result.exitCode !== 0)
      throw new Error("Could not clear framework reporter artifact.");
  }
  return {
    framework,
    command,
    async run(sandbox: Sandbox, target?: TestIdentity): Promise<NormalizedRun> {
      const exactCommand = command(target);
      let evidence: CommandEvidence = {
        command: exactCommand,
        exitCode: -1,
        stdout: "",
        stderr: "",
        durationMs: 0,
      };
      try {
        // Never accept the previous invocation's JSON after a crashed runner.
        await removeReport(sandbox);
        evidence = await runSandboxCommand(sandbox, exactCommand, projectRoot);
        const inspect = `const fs=require('fs');const s=fs.lstatSync(${JSON.stringify(report)});if(!s.isFile()||s.size>${MAX_REPORT_BYTES})process.exit(1)`;
        const size = await runSandboxCommand(
          sandbox,
          `node -e ${quote(inspect)}`,
          "/tmp",
        );
        if (size.exitCode !== 0)
          return errorRun(
            evidence,
            classifyError(`${evidence.stderr}\n${evidence.stdout}`),
          );
        const json = await readSandboxFile(sandbox, report);
        return parseFrameworkReport(json, evidence, projectRoot, target);
      } catch (error) {
        const text =
          error instanceof Error
            ? error.message
            : "Framework execution failed.";
        evidence = {
          ...evidence,
          stderr: `${evidence.stderr}\n${text}`.slice(-MAX_OUTPUT),
        };
        return errorRun(
          evidence,
          classifyError(`${evidence.stdout}\n${evidence.stderr}`),
        );
      } finally {
        try {
          await removeReport(sandbox);
        } catch {
          /* next execution must clear it before proceeding */
        }
      }
    },
  };
}
